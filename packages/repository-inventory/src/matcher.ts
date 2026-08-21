import { normalizeGitPath } from "@bytesmith/vcs-git";
import { InventoryError } from "./errors.js";
import type { InventoryPolicy, InventoryRule, PathMatcher } from "./types.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function policyFailure(message: string): never {
  throw new InventoryError("inventory_policy_invalid", message);
}

function matcherValues(matcher: PathMatcher): readonly (readonly string[])[] {
  return [
    matcher.exactPaths ?? [],
    matcher.pathPrefixes ?? [],
    matcher.fileNames ?? [],
    matcher.extensions ?? [],
    matcher.pathSegments ?? [],
  ];
}

function validateIdentifier(value: string, description: string): void {
  if (!identifierPattern.test(value)) {
    policyFailure(`${description} must be a stable identifier.`);
  }
}

function validateSimpleName(value: string, description: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.normalize("NFC") !== value
  ) {
    policyFailure(`${description} is not a normalized path component.`);
  }
}

function validatePolicyPath(value: string, description: string): void {
  try {
    if (normalizeGitPath(value) !== value) {
      policyFailure(`${description} is not normalized.`);
    }
  } catch (cause) {
    if (
      cause instanceof InventoryError &&
      cause.code === "inventory_policy_invalid"
    ) {
      throw cause;
    }
    policyFailure(`${description} is not a valid repository path.`);
  }
}

function validateMatcher(matcher: PathMatcher, description: string): void {
  if (matcherValues(matcher).every((values) => values.length === 0)) {
    policyFailure(`${description} must match at least one path.`);
  }
  for (const value of matcher.exactPaths ?? []) {
    validatePolicyPath(value, `${description} exact path`);
  }
  for (const value of matcher.pathPrefixes ?? []) {
    validatePolicyPath(value, `${description} path prefix`);
  }
  for (const value of matcher.fileNames ?? []) {
    validateSimpleName(value, `${description} file name`);
  }
  for (const value of matcher.pathSegments ?? []) {
    validateSimpleName(value, `${description} path segment`);
  }
  for (const value of matcher.extensions ?? []) {
    if (
      value.length < 2 ||
      !value.startsWith(".") ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      value.normalize("NFC") !== value
    ) {
      policyFailure(`${description} contains an invalid extension.`);
    }
  }
}

function validateRule(
  rule: InventoryRule,
  analyzerIds: ReadonlySet<string>,
): void {
  validateIdentifier(rule.id, "Inventory rule ID");
  if (rule.reason.trim().length === 0) {
    policyFailure(`Inventory rule ${rule.id} must include a reason.`);
  }
  validateMatcher(rule.matcher, `Inventory rule ${rule.id}`);
  const assigned = rule.analyzerIds ?? [];
  if (rule.kind === "partially_analyzed") {
    if (assigned.length === 0) {
      policyFailure(
        `Partially analyzed rule ${rule.id} must identify an analyzer.`,
      );
    }
    for (const analyzerId of assigned) {
      validateIdentifier(analyzerId, `Analyzer ID on rule ${rule.id}`);
      if (!analyzerIds.has(analyzerId)) {
        policyFailure(
          `Inventory rule ${rule.id} references an unknown analyzer.`,
        );
      }
    }
  } else if (assigned.length > 0) {
    policyFailure(
      `Inventory rule ${rule.id} cannot assign analyzers for ${rule.kind}.`,
    );
  }
}

export function validateInventoryPolicy(policy: InventoryPolicy): void {
  const analyzerIds = new Set<string>();
  for (const analyzer of policy.analyzerClaims) {
    validateIdentifier(analyzer.analyzerId, "Analyzer ID");
    if (analyzerIds.has(analyzer.analyzerId)) {
      policyFailure(
        `Analyzer ${analyzer.analyzerId} is declared more than once.`,
      );
    }
    analyzerIds.add(analyzer.analyzerId);
    validateMatcher(analyzer.matcher, `Analyzer ${analyzer.analyzerId}`);
  }
  const ruleIds = new Set<string>();
  for (const rule of policy.rules ?? []) {
    if (ruleIds.has(rule.id)) {
      policyFailure(`Inventory rule ${rule.id} is declared more than once.`);
    }
    ruleIds.add(rule.id);
    validateRule(rule, analyzerIds);
  }
}

export function pathMatches(path: string, matcher: PathMatcher): boolean {
  const segments = path.split("/");
  const fileName = segments.at(-1) ?? path;
  return (
    (matcher.exactPaths?.includes(path) ?? false) ||
    (matcher.pathPrefixes?.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ) ??
      false) ||
    (matcher.fileNames?.includes(fileName) ?? false) ||
    (matcher.extensions?.some((extension) => fileName.endsWith(extension)) ??
      false) ||
    (matcher.pathSegments?.some((segment) => segments.includes(segment)) ??
      false)
  );
}

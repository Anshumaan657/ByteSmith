import { computeSemanticDigest } from "@bytesmith/canonicalization";
import {
  deriveResult,
  isWaiverActive,
  type AuditEvent,
  type ImpactManifest,
} from "@bytesmith/impact-manifest";
import { normalizeRepositoryPath } from "@bytesmith/impact-types";

export interface ManifestValidationError {
  code: string;
  path: string;
  message: string;
}

export interface SemanticValidationOptions {
  verifyDigest?: boolean;
}

function indexById<T extends { id: string }>(
  items: readonly T[],
): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function addError(
  errors: ManifestValidationError[],
  code: string,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function checkUniqueIds(
  errors: ManifestValidationError[],
  path: string,
  items: readonly { id: string }[],
): void {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) {
      addError(
        errors,
        "duplicate-id",
        `${path}/${index}/id`,
        `Duplicate ID ${item.id}.`,
      );
    }
    seen.add(item.id);
  }
}

function checkReferences(
  errors: ManifestValidationError[],
  path: string,
  ids: readonly string[],
  target: ReadonlyMap<string, unknown>,
  label: string,
): void {
  for (const [index, id] of ids.entries()) {
    if (!target.has(id)) {
      addError(
        errors,
        "missing-reference",
        `${path}/${index}`,
        `${label} ${id} does not exist.`,
      );
    }
  }
}

function canonicalPath(value: string): boolean {
  try {
    return normalizeRepositoryPath(value) === value;
  } catch {
    return false;
  }
}

function checkAuditReferences(
  errors: ManifestValidationError[],
  path: string,
  entity: { id: string; auditEventIds: readonly string[] },
  audits: ReadonlyMap<string, AuditEvent>,
  entityType: AuditEvent["entityType"],
): void {
  for (const [index, id] of entity.auditEventIds.entries()) {
    const event = audits.get(id);
    if (!event) {
      addError(
        errors,
        "missing-reference",
        `${path}/auditEventIds/${index}`,
        `Audit event ${id} does not exist.`,
      );
    } else if (
      event.entityType !== entityType ||
      event.entityId !== entity.id
    ) {
      addError(
        errors,
        "audit-entity-mismatch",
        `${path}/auditEventIds/${index}`,
        "Audit event targets a different entity.",
      );
    }
  }
}

export function validateManifestSemantics(
  manifest: ImpactManifest,
  options: SemanticValidationOptions = {},
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];
  const collections: Array<[string, readonly { id: string }[]]> = [
    ["/analyzers", manifest.analyzers],
    ["/evidence", manifest.evidence],
    ["/changes", manifest.changes],
    ["/impacts", manifest.impacts],
    ["/tests/recommended", manifest.tests.recommended],
    ["/tests/gaps", manifest.tests.gaps],
    ["/unknowns", manifest.unknowns],
    ["/policies", manifest.policies],
    ["/dispositions", manifest.dispositions],
    ["/appeals", manifest.appeals],
    ["/waivers", manifest.waivers],
    ["/suspensions", manifest.suspensions],
    ["/auditEvents", manifest.auditEvents],
  ];
  for (const [path, items] of collections) checkUniqueIds(errors, path, items);

  const evidence = indexById(manifest.evidence);
  const changes = indexById(manifest.changes);
  const impacts = indexById(manifest.impacts);
  const testGaps = indexById(manifest.tests.gaps);
  const findings = new Map<string, unknown>([
    ...impacts.entries(),
    ...testGaps.entries(),
  ]);
  if (findings.size !== impacts.size + testGaps.size) {
    addError(
      errors,
      "duplicate-finding-id",
      "/",
      "Impact and test-gap IDs must be globally unique findings.",
    );
  }
  const unknowns = indexById(manifest.unknowns);
  const analyzers = indexById(manifest.analyzers);
  const suspensions = indexById(manifest.suspensions);
  const appeals = indexById(manifest.appeals);
  const waivers = indexById(manifest.waivers);
  const policies = indexById(manifest.policies);
  const audits = indexById(manifest.auditEvents);
  const governanceSources = new Map<string, unknown>([
    ...appeals.entries(),
    ...waivers.entries(),
    ...suspensions.entries(),
    ...policies.entries(),
  ]);

  const coverageFields = {
    analyzed: "analyzed",
    partially_analyzed: "partiallyAnalyzed",
    unsupported: "unsupported",
    intentionally_excluded: "intentionallyExcluded",
  } as const;
  const expected = {
    analyzed: 0,
    partiallyAnalyzed: 0,
    unsupported: 0,
    intentionallyExcluded: 0,
  };
  const paths = new Set<string>();
  if (
    manifest.scope.coverage.totalChangedFiles !== manifest.scope.files.length
  ) {
    addError(
      errors,
      "coverage-total",
      "/scope/coverage/totalChangedFiles",
      "Changed-file total must equal scope.files length.",
    );
  }
  for (const [index, file] of manifest.scope.files.entries()) {
    expected[coverageFields[file.coverageClass]] += 1;
    if (paths.has(file.path)) {
      addError(
        errors,
        "duplicate-path",
        `/scope/files/${index}/path`,
        `Changed path ${file.path} appears more than once.`,
      );
    }
    paths.add(file.path);
    if (!canonicalPath(file.path)) {
      addError(
        errors,
        "noncanonical-path",
        `/scope/files/${index}/path`,
        "Changed path is not canonical.",
      );
    }
    checkReferences(
      errors,
      `/scope/files/${index}/analyzerIds`,
      file.analyzerIds,
      analyzers,
      "Analyzer",
    );
  }
  for (const [field, count] of Object.entries(expected)) {
    if (manifest.scope.coverage[field as keyof typeof expected] !== count) {
      addError(
        errors,
        "coverage-bucket",
        `/scope/coverage/${field}`,
        `Expected ${count} from file classifications.`,
      );
    }
  }

  const allowedRevisions = new Set(
    [
      manifest.comparison.baseRevision,
      manifest.comparison.headRevision,
      manifest.comparison.mergeBaseRevision,
    ].filter((value): value is string => value !== undefined),
  );
  for (const [index, item] of manifest.evidence.entries()) {
    if (item.location.repository !== manifest.repository.id) {
      addError(
        errors,
        "evidence-repository",
        `/evidence/${index}/location/repository`,
        "Evidence repository must match the manifest repository.",
      );
    }
    if (!allowedRevisions.has(item.location.revision)) {
      addError(
        errors,
        "evidence-revision",
        `/evidence/${index}/location/revision`,
        "Evidence revision must be base, head, or merge base.",
      );
    }
    if (!canonicalPath(item.location.path)) {
      addError(
        errors,
        "noncanonical-path",
        `/evidence/${index}/location/path`,
        "Evidence path is not canonical.",
      );
    }
    if (
      item.location.startLine !== undefined &&
      item.location.endLine !== undefined &&
      item.location.endLine < item.location.startLine
    ) {
      addError(
        errors,
        "location-order",
        `/evidence/${index}/location/endLine`,
        "Evidence endLine precedes startLine.",
      );
    }
  }

  for (const [index, change] of manifest.changes.entries()) {
    checkReferences(
      errors,
      `/changes/${index}/evidenceIds`,
      change.evidenceIds,
      evidence,
      "Evidence",
    );
  }
  for (const [index, impact] of manifest.impacts.entries()) {
    checkReferences(
      errors,
      `/impacts/${index}/sourceChangeIds`,
      impact.sourceChangeIds,
      changes,
      "Change",
    );
    checkReferences(
      errors,
      `/impacts/${index}/evidenceIds`,
      impact.evidenceIds,
      evidence,
      "Evidence",
    );
  }
  for (const [index, recommendation] of manifest.tests.recommended.entries()) {
    checkReferences(
      errors,
      `/tests/recommended/${index}/evidenceIds`,
      recommendation.evidenceIds,
      evidence,
      "Evidence",
    );
  }
  for (const [index, gap] of manifest.tests.gaps.entries()) {
    checkReferences(
      errors,
      `/tests/gaps/${index}/evidenceIds`,
      gap.evidenceIds,
      evidence,
      "Evidence",
    );
  }
  for (const [index, unknown] of manifest.unknowns.entries()) {
    checkReferences(
      errors,
      `/unknowns/${index}/evidenceIds`,
      unknown.evidenceIds,
      evidence,
      "Evidence",
    );
  }

  for (const [index, policy] of manifest.policies.entries()) {
    checkReferences(
      errors,
      `/policies/${index}/findingIds`,
      policy.findingIds,
      findings,
      "Finding",
    );
    checkReferences(
      errors,
      `/policies/${index}/analysisGapIds`,
      policy.analysisGapIds,
      unknowns,
      "Analysis gap",
    );
    if (policy.result === "fail" && policy.findingIds.length === 0) {
      addError(
        errors,
        "empty-failing-policy",
        `/policies/${index}/findingIds`,
        "A failing policy must reference a finding.",
      );
    }
    if (policy.ruleState === "suspended") {
      const suspension = policy.suspensionId
        ? suspensions.get(policy.suspensionId)
        : undefined;
      if (!suspension || suspension.status !== "active") {
        addError(
          errors,
          "inactive-suspension",
          `/policies/${index}/suspensionId`,
          "Suspended policy must reference an active suspension.",
        );
      } else if (
        suspension.ruleId !== policy.ruleId ||
        suspension.ruleVersion !== policy.ruleVersion
      ) {
        addError(
          errors,
          "suspension-rule-mismatch",
          `/policies/${index}/suspensionId`,
          "Suspension rule and version must match the policy.",
        );
      }
      if (policy.result === "warn" && policy.findingIds.length === 0) {
        addError(
          errors,
          "hidden-suspended-finding",
          `/policies/${index}/findingIds`,
          "Suspended warning must retain a finding.",
        );
      }
      if (
        policy.result === "not_evaluated" &&
        policy.analysisGapIds.length === 0
      ) {
        addError(
          errors,
          "missing-suspension-gap",
          `/policies/${index}/analysisGapIds`,
          "Unsafe suspended policy must reference an analysis gap.",
        );
      }
    }
  }

  for (const [index, waiver] of manifest.waivers.entries()) {
    if (!findings.has(waiver.findingId))
      addError(
        errors,
        "missing-reference",
        `/waivers/${index}/findingId`,
        "Waiver finding does not exist.",
      );
    if (
      !(
        new Date(waiver.startsAt).valueOf() <
        new Date(waiver.expiresAt).valueOf()
      )
    ) {
      addError(
        errors,
        "waiver-interval",
        `/waivers/${index}`,
        "Waiver startsAt must precede expiresAt.",
      );
    }
    if (
      waiver.status === "active" &&
      !isWaiverActive(waiver, manifest.generatedAt)
    ) {
      addError(
        errors,
        "inactive-active-waiver",
        `/waivers/${index}/status`,
        "Active waiver interval does not contain generatedAt.",
      );
    }
    if (
      waiver.scope === "pull_request" &&
      waiver.pullRequestId !== manifest.comparison.pullRequestId
    )
      addError(
        errors,
        "waiver-pull-request",
        `/waivers/${index}/pullRequestId`,
        "Pull-request waiver identity must match.",
      );
    if (
      waiver.scope === "repository" &&
      waiver.repositoryId !== manifest.repository.id
    )
      addError(
        errors,
        "waiver-repository",
        `/waivers/${index}/repositoryId`,
        "Repository waiver identity must match.",
      );
    if (
      waiver.scope === "organization" &&
      waiver.organizationId !== manifest.repository.organizationId
    )
      addError(
        errors,
        "waiver-organization",
        `/waivers/${index}/organizationId`,
        "Organization waiver identity must match.",
      );
    if (waiver.selector?.ruleId) {
      const finding = impacts.get(waiver.findingId);
      if (!finding || finding.ruleId !== waiver.selector.ruleId)
        addError(
          errors,
          "waiver-selector",
          `/waivers/${index}/selector/ruleId`,
          "Waiver rule selector does not match its finding.",
        );
    }
    checkAuditReferences(errors, `/waivers/${index}`, waiver, audits, "waiver");
  }

  for (const [index, suspension] of manifest.suspensions.entries()) {
    checkReferences(
      errors,
      `/suspensions/${index}/evidenceIds`,
      suspension.evidenceIds,
      evidence,
      "Evidence",
    );
    if (
      suspension.scope === "repository" &&
      suspension.repositoryId !== manifest.repository.id
    )
      addError(
        errors,
        "suspension-repository",
        `/suspensions/${index}/repositoryId`,
        "Repository suspension identity must match.",
      );
    if (
      suspension.scope === "organization" &&
      suspension.organizationId !== manifest.repository.organizationId
    )
      addError(
        errors,
        "suspension-organization",
        `/suspensions/${index}/organizationId`,
        "Organization suspension identity must match.",
      );
    checkAuditReferences(
      errors,
      `/suspensions/${index}`,
      suspension,
      audits,
      "suspension",
    );
  }
  for (const [index, appeal] of manifest.appeals.entries()) {
    if (!findings.has(appeal.findingId))
      addError(
        errors,
        "missing-reference",
        `/appeals/${index}/findingId`,
        "Appeal finding does not exist.",
      );
    if (
      appeal.supersedingFindingId &&
      !findings.has(appeal.supersedingFindingId)
    )
      addError(
        errors,
        "missing-reference",
        `/appeals/${index}/supersedingFindingId`,
        "Superseding finding does not exist.",
      );
    checkAuditReferences(errors, `/appeals/${index}`, appeal, audits, "appeal");
    if (
      appeal.status === "terminal" &&
      !appeal.auditEventIds
        .map((id) => audits.get(id))
        .some(
          (event) =>
            event?.action === "appeal.adjudicated" &&
            event.toStatus === "terminal",
        )
    ) {
      addError(
        errors,
        "missing-appeal-audit",
        `/appeals/${index}/auditEventIds`,
        "Terminal appeal requires an adjudication audit event.",
      );
    }
  }
  for (const [index, disposition] of manifest.dispositions.entries()) {
    if (!findings.has(disposition.findingId))
      addError(
        errors,
        "missing-reference",
        `/dispositions/${index}/findingId`,
        "Disposition finding does not exist.",
      );
    if (!governanceSources.has(disposition.sourceId))
      addError(
        errors,
        "missing-reference",
        `/dispositions/${index}/sourceId`,
        "Disposition source does not exist.",
      );
    checkAuditReferences(
      errors,
      `/dispositions/${index}`,
      disposition,
      audits,
      "disposition",
    );
  }

  const derived = deriveResult(manifest);
  if (manifest.status.conclusion !== derived.conclusion) {
    addError(
      errors,
      "conclusion-mismatch",
      "/status/conclusion",
      `Expected derived conclusion ${derived.conclusion}.`,
    );
  }
  if (options.verifyDigest ?? true) {
    if (manifest.integrity.canonicalization !== "bytesmith-c14n-1")
      addError(
        errors,
        "canonicalization",
        "/integrity/canonicalization",
        "Unsupported canonicalization algorithm.",
      );
    if (manifest.integrity.semanticDigest.algorithm !== "sha256")
      addError(
        errors,
        "digest-algorithm",
        "/integrity/semanticDigest/algorithm",
        "Schema 1.0.0 requires sha256.",
      );
    else {
      const actual = computeSemanticDigest(manifest);
      if (manifest.integrity.semanticDigest.value !== actual)
        addError(
          errors,
          "digest-mismatch",
          "/integrity/semanticDigest/value",
          `Expected ${actual}.`,
        );
    }
  }
  return errors;
}

export function assertManifestSemantics(
  manifest: ImpactManifest,
  options?: SemanticValidationOptions,
): void {
  const errors = validateManifestSemantics(manifest, options);
  if (errors.length > 0) {
    throw new Error(
      errors
        .map((error) => `${error.path} [${error.code}] ${error.message}`)
        .join("\n"),
    );
  }
}

import { computeSemanticDigest, normalizeRepositoryPath } from "./canonicalization.mjs";
import { deriveResult, isWaiverActive } from "./result-states.mjs";

const coverageField = {
  analyzed: "analyzed",
  partially_analyzed: "partiallyAnalyzed",
  unsupported: "unsupported",
  intentionally_excluded: "intentionallyExcluded"
};

function indexById(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function addError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function checkUniqueIds(errors, path, items) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) {
      addError(errors, "duplicate-id", `${path}/${index}/id`, `Duplicate ID ${item.id}.`);
    }
    seen.add(item.id);
  }
}

function checkReferences(errors, path, ids, target, label) {
  for (const [index, id] of ids.entries()) {
    if (!target.has(id)) {
      addError(errors, "missing-reference", `${path}/${index}`, `${label} ${id} does not exist.`);
    }
  }
}

function isDateOrder(left, right) {
  return new Date(left).valueOf() < new Date(right).valueOf();
}

export function validateManifestSemantics(manifest, { verifyDigest = true } = {}) {
  const errors = [];
  const collections = [
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
    ["/auditEvents", manifest.auditEvents]
  ];
  for (const [path, items] of collections) checkUniqueIds(errors, path, items);

  const evidence = indexById(manifest.evidence);
  const changes = indexById(manifest.changes);
  const impacts = indexById(manifest.impacts);
  const testGaps = indexById(manifest.tests.gaps);
  const findings = new Map([...impacts, ...testGaps]);
  if (findings.size !== impacts.size + testGaps.size) {
    addError(errors, "duplicate-finding-id", "/", "Impact and test-gap IDs must be globally unique findings.");
  }
  const unknowns = indexById(manifest.unknowns);
  const analyzers = indexById(manifest.analyzers);
  const suspensions = indexById(manifest.suspensions);
  const appeals = indexById(manifest.appeals);
  const waivers = indexById(manifest.waivers);
  const policies = indexById(manifest.policies);
  const audits = indexById(manifest.auditEvents);
  const governanceSources = new Map([...appeals, ...waivers, ...suspensions, ...policies]);

  const files = manifest.scope.files;
  const coverage = manifest.scope.coverage;
  if (coverage.totalChangedFiles !== files.length) {
    addError(errors, "coverage-total", "/scope/coverage/totalChangedFiles", "Changed-file total must equal scope.files length.");
  }
  const expectedBucketCounts = {
    analyzed: 0,
    partiallyAnalyzed: 0,
    unsupported: 0,
    intentionallyExcluded: 0
  };
  const paths = new Set();
  for (const [index, file] of files.entries()) {
    expectedBucketCounts[coverageField[file.coverageClass]] += 1;
    if (paths.has(file.path)) {
      addError(errors, "duplicate-path", `/scope/files/${index}/path`, `Changed path ${file.path} appears more than once.`);
    }
    paths.add(file.path);
    if (normalizeRepositoryPath(file.path) !== file.path) {
      addError(errors, "noncanonical-path", `/scope/files/${index}/path`, "Changed path is not canonical.");
    }
    checkReferences(errors, `/scope/files/${index}/analyzerIds`, file.analyzerIds, analyzers, "Analyzer");
  }
  for (const [field, expected] of Object.entries(expectedBucketCounts)) {
    if (coverage[field] !== expected) {
      addError(errors, "coverage-bucket", `/scope/coverage/${field}`, `Expected ${expected} from file classifications, received ${coverage[field]}.`);
    }
  }
  const bucketSum = Object.values(expectedBucketCounts).reduce((sum, value) => sum + value, 0);
  if (bucketSum !== coverage.totalChangedFiles) {
    addError(errors, "coverage-sum", "/scope/coverage", "Coverage buckets must sum to totalChangedFiles.");
  }

  const allowedRevisions = new Set([
    manifest.comparison.baseRevision,
    manifest.comparison.headRevision,
    manifest.comparison.mergeBaseRevision
  ].filter(Boolean));
  for (const [index, item] of manifest.evidence.entries()) {
    if (item.location.repository !== manifest.repository.id) {
      addError(errors, "evidence-repository", `/evidence/${index}/location/repository`, "Evidence repository must match the manifest repository.");
    }
    if (!allowedRevisions.has(item.location.revision)) {
      addError(errors, "evidence-revision", `/evidence/${index}/location/revision`, "Evidence revision must be base, head, or merge base.");
    }
    if (normalizeRepositoryPath(item.location.path) !== item.location.path) {
      addError(errors, "noncanonical-path", `/evidence/${index}/location/path`, "Evidence path is not canonical.");
    }
    const startLine = item.location.startLine;
    const endLine = item.location.endLine;
    if (startLine && endLine && endLine < startLine) {
      addError(errors, "location-order", `/evidence/${index}/location/endLine`, "Evidence endLine precedes startLine.");
    }
  }

  for (const [index, change] of manifest.changes.entries()) {
    checkReferences(errors, `/changes/${index}/evidenceIds`, change.evidenceIds, evidence, "Evidence");
  }
  for (const [index, impact] of manifest.impacts.entries()) {
    checkReferences(errors, `/impacts/${index}/sourceChangeIds`, impact.sourceChangeIds, changes, "Change");
    checkReferences(errors, `/impacts/${index}/evidenceIds`, impact.evidenceIds, evidence, "Evidence");
  }
  for (const [index, recommendation] of manifest.tests.recommended.entries()) {
    checkReferences(errors, `/tests/recommended/${index}/evidenceIds`, recommendation.evidenceIds, evidence, "Evidence");
  }
  for (const [index, gap] of manifest.tests.gaps.entries()) {
    checkReferences(errors, `/tests/gaps/${index}/evidenceIds`, gap.evidenceIds, evidence, "Evidence");
  }
  for (const [index, unknown] of manifest.unknowns.entries()) {
    checkReferences(errors, `/unknowns/${index}/evidenceIds`, unknown.evidenceIds, evidence, "Evidence");
  }

  for (const [index, policy] of manifest.policies.entries()) {
    checkReferences(errors, `/policies/${index}/findingIds`, policy.findingIds, findings, "Finding");
    checkReferences(errors, `/policies/${index}/analysisGapIds`, policy.analysisGapIds, unknowns, "Analysis gap");
    if (policy.result === "fail" && policy.findingIds.length === 0) {
      addError(errors, "empty-failing-policy", `/policies/${index}/findingIds`, "A failing policy must reference a finding.");
    }
    if (policy.ruleState === "suspended") {
      const suspension = suspensions.get(policy.suspensionId);
      if (!suspension || suspension.status !== "active") {
        addError(errors, "inactive-suspension", `/policies/${index}/suspensionId`, "Suspended policy must reference an active suspension.");
      } else if (suspension.ruleId !== policy.ruleId || suspension.ruleVersion !== policy.ruleVersion) {
        addError(errors, "suspension-rule-mismatch", `/policies/${index}/suspensionId`, "Suspension rule and version must match the policy.");
      }
      if (policy.result === "warn" && policy.findingIds.length === 0) {
        addError(errors, "hidden-suspended-finding", `/policies/${index}/findingIds`, "Safely evaluated suspended warning must retain at least one finding.");
      }
      if (policy.result === "not_evaluated" && policy.analysisGapIds.length === 0) {
        addError(errors, "missing-suspension-gap", `/policies/${index}/analysisGapIds`, "Unsafe suspended policy must reference an analysis gap.");
      }
    }
  }

  for (const [index, waiver] of manifest.waivers.entries()) {
    if (!findings.has(waiver.findingId)) {
      addError(errors, "missing-reference", `/waivers/${index}/findingId`, `Finding ${waiver.findingId} does not exist.`);
    }
    if (!isDateOrder(waiver.startsAt, waiver.expiresAt)) {
      addError(errors, "waiver-interval", `/waivers/${index}`, "Waiver startsAt must precede expiresAt.");
    }
    if (waiver.status === "active" && !isWaiverActive(waiver, manifest.generatedAt)) {
      addError(errors, "inactive-active-waiver", `/waivers/${index}/status`, "Active waiver interval does not contain generatedAt.");
    }
    if (waiver.scope === "pull_request" && waiver.pullRequestId !== manifest.comparison.pullRequestId) {
      addError(errors, "waiver-pull-request", `/waivers/${index}/pullRequestId`, "Pull-request waiver identity must match the comparison.");
    }
    if (waiver.scope === "repository" && waiver.repositoryId !== manifest.repository.id) {
      addError(errors, "waiver-repository", `/waivers/${index}/repositoryId`, "Repository waiver identity must match the manifest repository.");
    }
    if (waiver.scope === "organization" && waiver.organizationId !== manifest.repository.organizationId) {
      addError(errors, "waiver-organization", `/waivers/${index}/organizationId`, "Organization waiver identity must match the repository organization.");
    }
    if (waiver.selector?.ruleId) {
      const finding = impacts.get(waiver.findingId);
      if (!finding || finding.ruleId !== waiver.selector.ruleId) {
        addError(errors, "waiver-selector", `/waivers/${index}/selector/ruleId`, "Waiver rule selector does not match its finding.");
      }
    }
    checkAuditReferences(errors, `/waivers/${index}`, waiver, audits, "waiver");
  }

  for (const [index, suspension] of manifest.suspensions.entries()) {
    checkReferences(errors, `/suspensions/${index}/evidenceIds`, suspension.evidenceIds, evidence, "Evidence");
    if (suspension.scope === "repository" && suspension.repositoryId !== manifest.repository.id) {
      addError(errors, "suspension-repository", `/suspensions/${index}/repositoryId`, "Repository suspension identity must match the manifest repository.");
    }
    if (suspension.scope === "organization" && suspension.organizationId !== manifest.repository.organizationId) {
      addError(errors, "suspension-organization", `/suspensions/${index}/organizationId`, "Organization suspension identity must match the repository organization.");
    }
    checkAuditReferences(errors, `/suspensions/${index}`, suspension, audits, "suspension");
  }

  for (const [index, appeal] of manifest.appeals.entries()) {
    if (!findings.has(appeal.findingId)) {
      addError(errors, "missing-reference", `/appeals/${index}/findingId`, `Finding ${appeal.findingId} does not exist.`);
    }
    if (appeal.supersedingFindingId && !findings.has(appeal.supersedingFindingId)) {
      addError(errors, "missing-reference", `/appeals/${index}/supersedingFindingId`, "Superseding finding does not exist.");
    }
    checkAuditReferences(errors, `/appeals/${index}`, appeal, audits, "appeal");
    if (appeal.status === "terminal") {
      const hasTerminalAudit = appeal.auditEventIds
        .map((id) => audits.get(id))
        .some((event) => event?.action === "appeal.adjudicated" && event.toStatus === "terminal");
      if (!hasTerminalAudit) {
        addError(errors, "missing-appeal-audit", `/appeals/${index}/auditEventIds`, "Terminal appeal requires an adjudication audit event.");
      }
    }
  }

  for (const [index, disposition] of manifest.dispositions.entries()) {
    if (!findings.has(disposition.findingId)) {
      addError(errors, "missing-reference", `/dispositions/${index}/findingId`, "Disposition finding does not exist.");
    }
    if (!governanceSources.has(disposition.sourceId)) {
      addError(errors, "missing-reference", `/dispositions/${index}/sourceId`, "Disposition source does not exist.");
    }
    checkAuditReferences(errors, `/dispositions/${index}`, disposition, audits, "disposition");
  }

  const derived = deriveResult(manifest);
  if (manifest.status.conclusion !== derived.conclusion) {
    addError(errors, "conclusion-mismatch", "/status/conclusion", `Expected derived conclusion ${derived.conclusion}, received ${manifest.status.conclusion}.`);
  }

  if (verifyDigest) {
    if (manifest.integrity.canonicalization !== "bytesmith-c14n-1") {
      addError(errors, "canonicalization", "/integrity/canonicalization", "Unsupported canonicalization algorithm.");
    }
    if (manifest.integrity.semanticDigest.algorithm !== "sha256") {
      addError(errors, "digest-algorithm", "/integrity/semanticDigest/algorithm", "Schema 1.0.0 requires sha256.");
    } else {
      const actual = computeSemanticDigest(manifest);
      if (manifest.integrity.semanticDigest.value !== actual) {
        addError(errors, "digest-mismatch", "/integrity/semanticDigest/value", `Expected ${actual}.`);
      }
    }
  }

  return errors;
}

function checkAuditReferences(errors, path, entity, audits, entityType) {
  for (const [index, id] of entity.auditEventIds.entries()) {
    const event = audits.get(id);
    if (!event) {
      addError(errors, "missing-reference", `${path}/auditEventIds/${index}`, `Audit event ${id} does not exist.`);
    } else if (event.entityType !== entityType || event.entityId !== entity.id) {
      addError(errors, "audit-entity-mismatch", `${path}/auditEventIds/${index}`, "Audit event targets a different entity.");
    }
  }
}

export function assertManifestSemantics(manifest, options) {
  const errors = validateManifestSemantics(manifest, options);
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `${error.path} [${error.code}] ${error.message}`).join("\n"));
  }
}

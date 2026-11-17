const REQUIRED_PROFILES = [
  "ordinary-typescript",
  "monorepo",
  "api-backend",
  "openapi",
  "older-inconsistent",
];

const MINIMUMS = {
  contractPrecision: 0.95,
  directConsumerPrecision: 0.9,
  testSelectionRecall: 0.8,
  determinismRate: 1,
  crashRate: 0,
  peakMemoryBytes: 3 * 1024 ** 3,
};

function object(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
}

function evaluations(value, name) {
  const record = object(value, name);
  if (!Array.isArray(record.evaluations)) {
    throw new TypeError(`${name}.evaluations must be an array.`);
  }
  return record.evaluations;
}

function completedProfiles(portfolio) {
  const records = evaluations(portfolio, "portfolio");
  return REQUIRED_PROFILES.map((profile) => {
    const matches = records.filter((record) => record.profile === profile);
    const record = matches.length === 1 ? matches[0] : undefined;
    return {
      profile,
      completed:
        record?.status === "completed" &&
        record.repository !== "REPLACE_WITH_CONSENTED_REPOSITORY" &&
        record.reviewer !== "UNASSIGNED" &&
        record.useful === true &&
        Array.isArray(record.observations) &&
        record.observations.length > 0,
    };
  });
}

function usabilitySummary(usability) {
  const records = evaluations(usability, "usability");
  const completed = records.filter(
    (record) =>
      record.status === "completed" &&
      record.evaluator !== "UNASSIGNED" &&
      record.withoutAssistance === true &&
      typeof record.usefulFinding === "string" &&
      record.usefulFinding.trim().length > 0 &&
      Array.isArray(record.observations) &&
      record.observations.length > 0,
  );
  return { completed: completed.length, total: records.length };
}

function benchmarkSummary(benchmark) {
  const input = object(benchmark, "benchmark");
  const report = object(input.report, "benchmark.report");
  const metrics = object(report.metrics, "benchmark.report.metrics");
  const gates = object(input.gates, "benchmark.gates");
  const requiredGates = [
    "contractPrecision",
    "directConsumerPrecision",
    "testSelectionRecall",
    "determinism",
    "crashFree",
    "smallPullRequestPerformance",
    "memoryWithinBudget",
  ];
  return {
    passed:
      input.passed === true &&
      requiredGates.every((name) => gates[name] === true) &&
      metrics.contractPrecision >= MINIMUMS.contractPrecision &&
      metrics.directConsumerPrecision >= MINIMUMS.directConsumerPrecision &&
      metrics.testSelectionRecall >= MINIMUMS.testSelectionRecall &&
      metrics.determinismRate === MINIMUMS.determinismRate &&
      metrics.crashRate === MINIMUMS.crashRate &&
      metrics.peakMemoryBytes < MINIMUMS.peakMemoryBytes,
    gates: structuredClone(gates),
    metrics: {
      contractPrecision: metrics.contractPrecision,
      directConsumerPrecision: metrics.directConsumerPrecision,
      testSelectionRecall: metrics.testSelectionRecall,
      determinismRate: metrics.determinismRate,
      crashRate: metrics.crashRate,
      peakMemoryBytes: metrics.peakMemoryBytes,
    },
  };
}

export function createReleaseAudit({
  benchmark,
  portfolio,
  usability,
  generatedAt,
  revision,
}) {
  if (typeof generatedAt !== "string" || generatedAt.length === 0) {
    throw new TypeError("generatedAt must be non-empty text.");
  }
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new TypeError("revision must be an exact 40-character Git commit.");
  }
  const automated = benchmarkSummary(benchmark);
  const profiles = completedProfiles(portfolio);
  const repositories = {
    completed: profiles.filter((item) => item.completed).length,
    total: REQUIRED_PROFILES.length,
    missingProfiles: profiles
      .filter((item) => !item.completed)
      .map((item) => item.profile),
  };
  const usabilityResult = usabilitySummary(usability);
  const externalReady =
    repositories.completed === repositories.total &&
    usabilityResult.completed >= 5;
  const releaseReady = automated.passed && externalReady;
  const code = !automated.passed
    ? "automated_gates_failed"
    : !externalReady
      ? "external_evidence_pending"
      : "ready";
  return {
    schemaVersion: "1.0.0",
    generatedAt,
    release: {
      product: "ByteSmith Verify",
      version: "0.1.0",
      revision,
    },
    automated,
    externalEvidence: {
      repositoryPortfolio: repositories,
      usability: { ...usabilityResult, required: 5 },
    },
    conclusion: {
      releaseReady,
      code,
      summary: releaseReady
        ? "All automated and external Verify 0.1 release gates are satisfied."
        : code === "automated_gates_failed"
          ? "Automated Verify 0.1 release gates failed; do not create a release tag."
          : "Automated gates passed, but real-repository or independent usability evidence is pending.",
    },
  };
}

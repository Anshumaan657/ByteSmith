import assert from "node:assert/strict";
import test from "node:test";
import {
  renderAdvisoryReport,
  publishAdvisoryReport,
  GitHubReportError,
  REPORT_MARKER,
} from "../dist/report.js";

function makeManifest(overrides = {}) {
  const base = {
    schemaVersion: "1.0.0",
    manifestId: "test-manifest",
    generatedAt: "2024-01-01T00:00:00.000Z",
    engine: { name: "ByteSmith", version: "0.1.0", ruleSetVersion: "0.1.0" },
    repository: {
      id: "repo-1",
      name: "test-repo",
      vcs: "git",
      remote: "https://github.com/example/test-repo",
    },
    comparison: {
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      mergeBaseRevision: "a".repeat(40),
    },
    configurationDigest: { algorithm: "sha256", value: "c".repeat(64) },
    status: { conclusion: "warn", reasons: [] },
    scope: {
      files: [],
      coverage: {
        totalChangedFiles: 10,
        analyzed: 5,
        partiallyAnalyzed: 2,
        unsupported: 2,
        intentionallyExcluded: 1,
      },
    },
    analyzers: [
      { id: "bytesmith.typescript", version: "0.1.0", required: true, status: "completed", diagnostics: [] },
      { id: "bytesmith.openapi", version: "0.1.0", required: false, status: "not_applicable", diagnostics: [] },
    ],
    evidence: [
      {
        id: "ev-1",
        kind: "type",
        producer: { id: "bytesmith.typescript", version: "0.1.0" },
        location: { repository: "repo-1", revision: "b".repeat(40), path: "src/api.ts", startLine: 10 },
        summary: "Type change evidence",
      },
      {
        id: "ev-2",
        kind: "contract",
        producer: { id: "bytesmith.typescript", version: "0.1.0" },
        location: { repository: "repo-1", revision: "b".repeat(40), path: "src/contract.ts", startLine: 20 },
        summary: "Contract evidence",
      },
    ],
    changes: [
      {
        id: "ch-1",
        kind: "contract",
        summary: "Return type changed from string to number",
        compatibility: "breaking",
        component: { id: "comp-1", kind: "symbol", name: "greet" },
        evidenceIds: ["ev-1"],
      },
      {
        id: "ch-2",
        kind: "symbol",
        summary: "New optional parameter added",
        compatibility: "potentially_breaking",
        component: { id: "comp-2", kind: "symbol", name: "calculate" },
        evidenceIds: ["ev-2"],
      },
    ],
    impacts: [
      {
        id: "imp-1",
        ruleId: "typescript.return-type",
        ruleVersion: "0.1.0",
        category: "direct",
        severity: "high",
        confidence: "verified",
        summary: "Consumer calls greet() expecting string",
        sourceChangeIds: ["ch-1"],
        affectedComponents: [{ id: "comp-3", kind: "symbol", name: "caller" }],
        evidenceIds: ["ev-1"],
      },
    ],
    tests: {
      recommended: [
        {
          id: "test-1",
          test: { id: "test-comp-1", kind: "test", name: "caller.test.ts" },
          command: "npm test -- caller.test.ts",
          reason: "Direct consumer of changed function",
          evidenceIds: ["ev-1"],
        },
      ],
      gaps: [
        {
          id: "gap-1",
          affectedComponent: { id: "comp-4", kind: "symbol", name: "uncovered" },
          gapKind: "not_found",
          reason: "No test found for uncovered function",
          evidenceIds: ["ev-2"],
        },
      ],
    },
    unknowns: [
      {
        id: "unk-1",
        type: "dynamic_import",
        summary: "Dynamic import prevents analysis",
        locations: [{ repository: "repo-1", revision: "b".repeat(40), path: "src/loader.ts", startLine: 5 }],
        evidenceIds: [],
        blockingRelevance: "possible",
      },
    ],
    policies: [],
    dispositions: [],
    appeals: [],
    waivers: [],
    suspensions: [],
    auditEvents: [],
    integrity: {
      canonicalization: "bytesmith-c14n-1",
      semanticDigest: { algorithm: "sha256", value: "d".repeat(64) },
    },
    ...overrides,
  };
  return base;
}

test("renderAdvisoryReport produces deterministic output", () => {
  const manifest = makeManifest();
  const report1 = renderAdvisoryReport(manifest, "example/test-repo");
  const report2 = renderAdvisoryReport(manifest, "example/test-repo");
  assert.equal(report1, report2);
});

test("renderAdvisoryReport includes stable marker", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes(REPORT_MARKER));
});

test("renderAdvisoryReport includes advisory disclaimer", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("Advisory only in Verify 0.1"));
  assert.ok(report.includes("never blocks merging"));
});

test("renderAdvisoryReport includes exact revisions", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("`aaaaaaaaaaaa`")); // base (12 chars)
  assert.ok(report.includes("`bbbbbbbbbbbb`")); // head (12 chars)
  assert.ok(report.includes("`aaaaaaaaaaaa`")); // merge base (12 chars)
});

test("renderAdvisoryReport includes semantic digest", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("d".repeat(12))); // truncated digest
});

test("renderAdvisoryReport includes coverage with correct field names", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("7/10 analyzed or partially analyzed"));
  assert.ok(report.includes("2 unsupported"));
  assert.ok(report.includes("1 excluded"));
});

test("renderAdvisoryReport includes breaking and potentially breaking changes", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("**breaking**"));
  assert.ok(report.includes("**potentially_breaking**"));
  assert.ok(report.includes("Return type changed from string to number"));
  assert.ok(report.includes("New optional parameter added"));
});

test("renderAdvisoryReport includes affected consumers", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("**caller**"));
  assert.ok(report.includes("Consumer calls greet() expecting string"));
  assert.ok(report.includes("verified confidence"));
});

test("renderAdvisoryReport includes recommended tests with commands", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("`npm test -- caller.test.ts`"));
  assert.ok(report.includes("Direct consumer of changed function"));
});

test("renderAdvisoryReport includes test gaps", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("**uncovered**"));
  assert.ok(report.includes("No test found for uncovered function"));
});

test("renderAdvisoryReport includes unknowns", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("**possible**"));
  assert.ok(report.includes("Dynamic import prevents analysis"));
});

test("renderAdvisoryReport includes analyzer health", () => {
  const manifest = makeManifest({
    analyzers: [
      { id: "bytesmith.typescript", version: "0.1.0", required: true, status: "completed", diagnostics: [] },
      { id: "bytesmith.openapi", version: "0.1.0", required: false, status: "error", diagnostics: ["Failed to parse OpenAPI spec"] },
    ],
  });
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("**bytesmith.openapi** is error"));
  assert.ok(report.includes("Failed to parse OpenAPI spec"));
});

test("renderAdvisoryReport escapes markdown and HTML", () => {
  const manifest = makeManifest({
    changes: [
      {
        id: "ch-1",
        kind: "contract",
        summary: "Injection <script>alert(1)</script> | table",
        compatibility: "breaking",
        component: { id: "comp-1", kind: "symbol", name: "test" },
        evidenceIds: [],
      },
    ],
    impacts: [],
    tests: { recommended: [], gaps: [] },
    unknowns: [],
    analyzers: [{ id: "bytesmith.typescript", version: "0.1.0", required: true, status: "completed", diagnostics: [] }],
  });
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(report.includes("\\|"));
  assert.ok(!report.includes("<script>"));
});

test("renderAdvisoryReport bounds long sections", () => {
  const manyChanges = Array.from({ length: 30 }, (_, i) => ({
    id: `ch-${i}`,
    kind: "contract",
    summary: `Change ${i}`,
    compatibility: "breaking",
    component: { id: `comp-${i}`, kind: "symbol", name: `fn${i}` },
    evidenceIds: [],
  }));
  const manifest = makeManifest({ changes: manyChanges });
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("…and 5 more."));
});

test("renderAdvisoryReport evidence links use exact head commit", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  const headShort = "b".repeat(12);
  assert.ok(report.includes(`blob/${"b".repeat(40)}/`));
  assert.ok(!report.includes("main"));
  assert.ok(!report.includes("HEAD"));
});

test("renderAdvisoryReport shows conclusion icon", () => {
  const passManifest = makeManifest({ status: { conclusion: "pass", reasons: [] } });
  const warnManifest = makeManifest({ status: { conclusion: "warn", reasons: [] } });
  const failManifest = makeManifest({ status: { conclusion: "fail", reasons: [] } });
  const incompleteManifest = makeManifest({ status: { conclusion: "incomplete", reasons: [] } });
  const errorManifest = makeManifest({ status: { conclusion: "error", reasons: [] } });

  assert.ok(renderAdvisoryReport(passManifest, "example/test-repo").includes("✅"));
  assert.ok(renderAdvisoryReport(warnManifest, "example/test-repo").includes("⚠️"));
  assert.ok(renderAdvisoryReport(failManifest, "example/test-repo").includes("🛑"));
  assert.ok(renderAdvisoryReport(incompleteManifest, "example/test-repo").includes("🛑"));
  assert.ok(renderAdvisoryReport(errorManifest, "example/test-repo").includes("🛑"));
});

test("renderAdvisoryReport includes engine and rule set versions", () => {
  const manifest = makeManifest();
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("Engine 0.1.0"));
  assert.ok(report.includes("Rule set 0.1.0"));
});

test("renderAdvisoryReport handles empty sections gracefully", () => {
  const manifest = makeManifest({
    changes: [],
    impacts: [],
    tests: { recommended: [], gaps: [] },
    unknowns: [],
    analyzers: [{ id: "bytesmith.typescript", version: "0.1.0", required: true, status: "completed", diagnostics: [] }],
  });
  const report = renderAdvisoryReport(manifest, "example/test-repo");
  assert.ok(report.includes("No breaking contract change was identified"));
  assert.ok(report.includes("No affected consumer was linked"));
  assert.ok(report.includes("No targeted test was recommended"));
  assert.ok(report.includes("No test gap was reported"));
  assert.ok(report.includes("No analysis unknown was reported"));
  assert.ok(report.includes("All applicable analyzers completed"));
});

test("publishAdvisoryReport requires a token", async () => {
  await assert.rejects(
    () => publishAdvisoryReport({ repository: "example/test", pullRequestNumber: 1, analyzedHead: "b".repeat(40), token: "", body: "test" }),
    { code: "missing_github_token" },
  );
});

test("publishAdvisoryReport rejects stale head", async () => {
  const mockFetch = async (url) => {
    if (url.includes("/pulls/1")) {
      return { ok: true, json: async () => ({ head: { sha: "c".repeat(40) } }) };
    }
    if (url.includes("/comments")) {
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => ({}) };
  };

  await assert.rejects(
    () =>
      publishAdvisoryReport({
        repository: "example/test",
        pullRequestNumber: 1,
        analyzedHead: "b".repeat(40),
        token: "token",
        body: "test",
        fetch: mockFetch,
      }),
    { code: "stale_analysis" },
  );
});

test("publishAdvisoryReport creates new comment when none exists", async () => {
  const createdComment = { id: 123 };
  const mockFetch = async (url, init) => {
    if (url.includes("/pulls/1")) {
      return { ok: true, json: async () => ({ head: { sha: "b".repeat(40) } }) };
    }
    if (url.includes("/issues/1/comments") && (!init?.method || init?.method === "GET")) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes("/issues/1/comments") && init?.method === "POST") {
      return { ok: true, json: async () => createdComment };
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await publishAdvisoryReport({
    repository: "example/test",
    pullRequestNumber: 1,
    analyzedHead: "b".repeat(40),
    token: "token",
    body: "test",
    fetch: mockFetch,
  });

  assert.equal(result.state, "created");
  assert.equal(result.commentId, 123);
});

test("publishAdvisoryReport updates existing bot comment", async () => {
  const existingComment = { id: 456, user: { type: "Bot" }, body: `${REPORT_MARKER} old` };
  const updatedComment = { id: 456 };
  const mockFetch = async (url, init) => {
    if (url.includes("/pulls/1")) {
      return { ok: true, json: async () => ({ head: { sha: "b".repeat(40) } }) };
    }
    if (url.includes("/issues/1/comments") && (!init?.method || init?.method === "GET")) {
      return { ok: true, json: async () => [existingComment] };
    }
    if (url.includes("/issues/comments/456") && init?.method === "PATCH") {
      return { ok: true, json: async () => updatedComment };
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await publishAdvisoryReport({
    repository: "example/test",
    pullRequestNumber: 1,
    analyzedHead: "b".repeat(40),
    token: "token",
    body: "test",
    fetch: mockFetch,
  });

  assert.equal(result.state, "updated");
  assert.equal(result.commentId, 456);
});

test("publishAdvisoryReport finds bot comment among others", async () => {
  const userComment = { id: 111, user: { type: "User" }, body: "User comment" };
  const botComment = { id: 222, user: { type: "Bot" }, body: `${REPORT_MARKER} old` };
  const mockFetch = async (url, init) => {
    if (url.includes("/pulls/1")) {
      return { ok: true, json: async () => ({ head: { sha: "b".repeat(40) } }) };
    }
    if (url.includes("/issues/1/comments") && (!init?.method || init?.method === "GET")) {
      return { ok: true, json: async () => [userComment, botComment] };
    }
    if (url.includes("/issues/comments/222") && init?.method === "PATCH") {
      return { ok: true, json: async () => ({ id: 222 }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await publishAdvisoryReport({
    repository: "example/test",
    pullRequestNumber: 1,
    analyzedHead: "b".repeat(40),
    token: "token",
    body: "test",
    fetch: mockFetch,
  });

  assert.equal(result.state, "updated");
  assert.equal(result.commentId, 222);
});

test("publishAdvisoryReport handles pagination", async () => {
  const comments = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    user: { type: i === 99 ? "Bot" : "User" },
    body: i === 99 ? `${REPORT_MARKER} last` : `comment ${i}`,
  }));
  const mockFetch = async (url, init) => {
    if (url.includes("/pulls/1")) {
      return { ok: true, json: async () => ({ head: { sha: "b".repeat(40) } }) };
    }
    if (url.includes("/issues/1/comments") && (!init?.method || init?.method === "GET")) {
      return { ok: true, json: async () => comments };
    }
    if (url.includes("/issues/comments/100") && init?.method === "PATCH") {
      return { ok: true, json: async () => ({ id: 100 }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await publishAdvisoryReport({
    repository: "example/test",
    pullRequestNumber: 1,
    analyzedHead: "b".repeat(40),
    token: "token",
    body: "test",
    fetch: mockFetch,
  });

  assert.equal(result.state, "updated");
  assert.equal(result.commentId, 100);
});

test("publishAdvisoryReport handles 403 permission denied", async () => {
  const mockFetch = async (url) => {
    if (url.includes("/pulls/1")) {
      return { ok: true, json: async () => ({ head: { sha: "b".repeat(40) } }) };
    }
    if (url.includes("/issues/1/comments")) {
      return { ok: false, status: 403, json: async () => ({ message: "Forbidden" }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  await assert.rejects(
    () =>
      publishAdvisoryReport({
        repository: "example/test",
        pullRequestNumber: 1,
        analyzedHead: "b".repeat(40),
        token: "token",
        body: "test",
        fetch: mockFetch,
      }),
    { code: "permission_denied" },
  );
});

test("publishAdvisoryReport handles network errors", async () => {
  const mockFetch = async () => {
    throw new Error("Network error");
  };

  await assert.rejects(
    () =>
      publishAdvisoryReport({
        repository: "example/test",
        pullRequestNumber: 1,
        analyzedHead: "b".repeat(40),
        token: "token",
        body: "test",
        fetch: mockFetch,
      }),
    { code: "github_api_error" },
  );
});

test("publishAdvisoryReport handles malformed API responses", async () => {
  const mockFetch = async (url) => {
    if (url.includes("/pulls/1")) {
      return { ok: false, status: 500, json: async () => ({ message: "Internal Server Error" }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  await assert.rejects(
    () =>
      publishAdvisoryReport({
        repository: "example/test",
        pullRequestNumber: 1,
        analyzedHead: "b".repeat(40),
        token: "token",
        body: "test",
        fetch: mockFetch,
      }),
    { code: "github_api_error" },
  );
});

test("publishAdvisoryReport supports GitHub Enterprise URLs", async () => {
  const mockFetch = async (url, init) => {
    if (url.includes("ghe.example.com")) {
      if (url.includes("/pulls/1")) {
        return { ok: true, json: async () => ({ head: { sha: "b".repeat(40) } }) };
      }
      if (url.includes("/issues/1/comments") && (!init?.method || init?.method === "GET")) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes("/issues/1/comments") && init?.method === "POST") {
        return { ok: true, json: async () => ({ id: 789 }) };
      }
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await publishAdvisoryReport({
    repository: "example/test",
    pullRequestNumber: 1,
    analyzedHead: "b".repeat(40),
    token: "token",
    body: "test",
    apiUrl: "https://ghe.example.com/api/v3",
    fetch: mockFetch,
  });

  assert.equal(result.state, "created");
  assert.equal(result.commentId, 789);
});

test("GitHubReportError has correct properties", () => {
  const error = new GitHubReportError("test_code", "Test message", { status: 404 });
  assert.equal(error.name, "GitHubReportError");
  assert.equal(error.code, "test_code");
  assert.equal(error.status, 404);
  assert.ok(error instanceof Error);
});

test("GitHubReportError preserves cause", () => {
  const cause = new Error("root cause");
  const error = new GitHubReportError("test_code", "Wrapper", { cause });
  assert.equal(error.cause, cause);
});
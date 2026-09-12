import type { ImpactManifest } from "@bytesmith/impact-manifest";

export const REPORT_MARKER = "<!-- bytesmith-verify:report:v1 -->";
const MAX_ITEMS = 25;
const MAX_REPORT_LENGTH = 60_000;

export interface GitHubComment {
  id: number;
  body: string | null | undefined;
  user: { type: string | null | undefined } | null | undefined;
}

export interface PublishResult {
  state: "created" | "updated";
  commentId: number;
}

export class GitHubReportError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, options);
    this.name = "GitHubReportError";
    this.code = code;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
  }
}

function safe(value: string): string {
  return value
    .normalize("NFC")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n]+/gu, " ");
}

function shortRevision(revision: string | undefined): string {
  return revision ? revision.slice(0, 12) : "unavailable";
}

function evidenceLink(
  repository: string,
  head: string,
  evidence: ImpactManifest["evidence"][number],
  serverUrl: string,
): string {
  const path = evidence.location.path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const line = evidence.location.startLine;
  return `${serverUrl}/${repository}/blob/${head}/${path}${line ? `#L${line}${evidence.location.endLine && evidence.location.endLine !== line ? `-L${evidence.location.endLine}` : ""}` : ""}`;
}

function section(
  title: string,
  entries: readonly string[],
  empty: string,
): string[] {
  const visible = entries.slice(0, MAX_ITEMS);
  return [
    `### ${title}`,
    "",
    ...(visible.length === 0 ? [empty] : visible.map((entry) => `- ${entry}`)),
    ...(entries.length > visible.length
      ? [`- …and ${entries.length - visible.length} more.`]
      : []),
    "",
  ];
}

export function renderAdvisoryReport(
  manifest: ImpactManifest,
  repository: string,
  serverUrl = "https://github.com",
): string {
  const head = manifest.comparison.headRevision;
  const evidence = new Map(manifest.evidence.map((item) => [item.id, item]));
  const links = (ids: readonly string[]) =>
    ids
      .map((id) => evidence.get(id))
      .filter((item): item is ImpactManifest["evidence"][number] =>
        Boolean(item),
      )
      .slice(0, 3)
      .map(
        (item, index) =>
          `[evidence ${index + 1}](${evidenceLink(repository, head, item, serverUrl.replace(/\/$/u, ""))})`,
      )
      .join(", ");
  const breaking = manifest.changes
    .filter((change) =>
      ["breaking", "potentially_breaking"].includes(change.compatibility),
    )
    .map(
      (change) =>
        `**${safe(change.compatibility)}** — ${safe(change.summary)}${links(change.evidenceIds) ? ` (${links(change.evidenceIds)})` : ""}`,
    );
  const consumers = manifest.impacts.flatMap((impact) =>
    impact.affectedComponents.map(
      (component) =>
        `**${safe(component.name)}** — ${safe(impact.summary)} · ${safe(impact.confidence)} confidence${links(impact.evidenceIds) ? ` (${links(impact.evidenceIds)})` : ""}`,
    ),
  );
  const recommendations = manifest.tests.recommended.map(
    (test) =>
      `\`${safe(test.command)}\` — ${safe(test.reason)}${links(test.evidenceIds) ? ` (${links(test.evidenceIds)})` : ""}`,
  );
  const gaps = manifest.tests.gaps.map(
    (gap) =>
      `**${safe(gap.affectedComponent.name)}** — ${safe(gap.reason)}${links(gap.evidenceIds) ? ` (${links(gap.evidenceIds)})` : ""}`,
  );
  const unknowns = manifest.unknowns.map(
    (unknown) =>
      `**${safe(unknown.blockingRelevance)}** — ${safe(unknown.summary)}${links(unknown.evidenceIds) ? ` (${links(unknown.evidenceIds)})` : ""}`,
  );
  const analyzerProblems = manifest.analyzers
    .filter(
      (analyzer) => !["completed", "not_applicable"].includes(analyzer.status),
    )
    .map(
      (analyzer) =>
        `**${safe(analyzer.id)}** is ${safe(analyzer.status)}${analyzer.diagnostics.length ? ` — ${safe(analyzer.diagnostics.join("; "))}` : ""}`,
    );
  const coverage = manifest.scope.coverage;
  const icon =
    manifest.status.conclusion === "pass"
      ? "✅"
      : manifest.status.conclusion === "warn"
        ? "⚠️"
        : "🛑";

  const report = [
    REPORT_MARKER,
    `## ${icon} ByteSmith Verify: ${manifest.status.conclusion.toUpperCase()}`,
    "",
    "> Advisory only in Verify 0.1 — this report never blocks merging.",
    "",
    `| Binding | Value |`,
    `|---|---|`,
    `| Base | \`${shortRevision(manifest.comparison.baseRevision)}\` |`,
    `| Head | \`${shortRevision(head)}\` |`,
    `| Merge base | \`${shortRevision(manifest.comparison.mergeBaseRevision)}\` |`,
    `| Semantic digest | \`${manifest.integrity.semanticDigest.value}\` |`,
    `| Changed-file coverage | ${coverage.analyzed + coverage.partiallyAnalyzed}/${coverage.totalChangedFiles} analyzed or partially analyzed; ${coverage.unsupported} unsupported; ${coverage.intentionallyExcluded} excluded |`,
    "",
    ...section(
      "Breaking contract changes",
      breaking,
      "No breaking contract change was identified in the analyzed scope.",
    ),
    ...section(
      "Affected consumers",
      consumers,
      "No affected consumer was linked.",
    ),
    ...section(
      "Recommended tests",
      recommendations,
      "No targeted test was recommended.",
    ),
    ...section("Test gaps", gaps, "No test gap was reported."),
    ...section(
      "Unknowns and coverage gaps",
      unknowns,
      "No analysis unknown was reported.",
    ),
    ...section(
      "Analyzer health",
      analyzerProblems,
      "All applicable analyzers completed.",
    ),
    `<sub>Manifest ${safe(manifest.manifestId)} · Engine ${safe(manifest.engine.version)} · Rule set ${safe(manifest.engine.ruleSetVersion)}</sub>`,
  ].join("\n");
  if (report.length <= MAX_REPORT_LENGTH) return report;
  const suffix = "\n\n_Report truncated to fit GitHub's comment limit._";
  return `${report.slice(0, MAX_REPORT_LENGTH - suffix.length)}${suffix}`;
}

interface PublishOptions {
  repository: string;
  pullRequestNumber: number;
  analyzedHead: string;
  token: string;
  body: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function publishAdvisoryReport(
  options: PublishOptions,
): Promise<PublishResult> {
  if (!options.token.trim()) {
    throw new GitHubReportError(
      "missing_github_token",
      "No GitHub token was provided for pull-request reporting.",
    );
  }
  const request = options.fetch ?? globalThis.fetch;
  const api = (options.apiUrl ?? "https://api.github.com").replace(/\/$/u, "");
  const root = `${api}/repos/${options.repository}`;
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${options.token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
  const call = async (url: string, init?: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await request(url, { ...init, headers });
    } catch (cause) {
      throw new GitHubReportError(
        "github_api_error",
        "GitHub API request failed.",
        {
          cause,
        },
      );
    }
    const value = await responseJson(response);
    if (!response.ok) {
      throw new GitHubReportError(
        response.status === 403 ? "permission_denied" : "github_api_error",
        `GitHub API returned HTTP ${response.status}.`,
        { status: response.status },
      );
    }
    return value;
  };

  const current = (await call(
    `${root}/pulls/${options.pullRequestNumber}`,
  )) as { head?: { sha?: unknown } };
  if (current.head?.sha !== options.analyzedHead) {
    throw new GitHubReportError(
      "stale_analysis",
      "The pull-request head changed after analysis; ByteSmith refused to publish stale findings.",
    );
  }

  const comments = (await call(
    `${root}/issues/${options.pullRequestNumber}/comments?per_page=100`,
  )) as GitHubComment[];
  const existing = Array.isArray(comments)
    ? comments.find(
        (comment) =>
          comment.user?.type === "Bot" &&
          typeof comment.body === "string" &&
          comment.body.includes(REPORT_MARKER),
      )
    : undefined;
  const result = (await call(
    existing
      ? `${root}/issues/comments/${existing.id}`
      : `${root}/issues/${options.pullRequestNumber}/comments`,
    {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({ body: options.body }),
    },
  )) as { id?: unknown };
  if (!Number.isSafeInteger(result.id)) {
    throw new GitHubReportError(
      "github_api_error",
      "GitHub returned an invalid comment response.",
    );
  }
  return {
    state: existing ? "updated" : "created",
    commentId: result.id as number,
  };
}

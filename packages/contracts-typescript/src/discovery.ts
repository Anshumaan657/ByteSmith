import { compareCodePoints, validateStableId } from "@bytesmith/impact-types";
import { discoverProjectConfiguration } from "./config.js";
import { TypeScriptDiscoveryError } from "./errors.js";
import {
  resolveRepositoryRoot,
  scanRepository,
  sortDiagnostics,
} from "./path.js";
import type {
  DiscoverTypeScriptProjectsOptions,
  RepositoryProjectDiscovery,
} from "./types.js";
import { discoverWorkspace } from "./workspace.js";

export async function discoverTypeScriptProjects(
  options: DiscoverTypeScriptProjectsOptions,
): Promise<RepositoryProjectDiscovery> {
  let repositoryId: string;
  try {
    repositoryId = validateStableId(options.repositoryId, "Repository ID");
  } catch (cause) {
    throw new TypeScriptDiscoveryError(
      "repository_identity_invalid",
      "TypeScript discovery requires the stable repository ID from Phase 3.",
      cause,
    );
  }
  const repositoryRoot = await resolveRepositoryRoot(options.repositoryRoot);
  const scanned = await scanRepository(repositoryRoot);
  const workspaceResult = await discoverWorkspace(
    repositoryId,
    repositoryRoot,
    scanned.packageFiles,
    scanned.pnpmWorkspaceFiles,
    scanned.yarnLockFiles,
  );
  const projects = scanned.configFiles
    .map((configPath) =>
      discoverProjectConfiguration(
        repositoryId,
        repositoryRoot,
        configPath,
        workspaceResult.workspace.packages,
      ),
    )
    .sort((left, right) =>
      compareCodePoints(left.configPath, right.configPath),
    );
  const diagnostics = sortDiagnostics([
    ...scanned.diagnostics,
    ...workspaceResult.diagnostics,
    ...projects.flatMap((project) => project.diagnostics),
  ]);
  return {
    schemaVersion: "1.0.0",
    repositoryId,
    workspace: workspaceResult.workspace,
    projects,
    diagnostics,
    status:
      diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
      projects.some((project) => project.status === "incomplete")
        ? "incomplete"
        : "completed",
  };
}

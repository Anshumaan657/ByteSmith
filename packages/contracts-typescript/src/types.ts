export type WorkspaceManager = "npm" | "pnpm" | "yarn" | "none";
export type DiscoveryStatus = "completed" | "incomplete";
export type DiagnosticSeverity = "warning" | "error";

export type DiscoveryDiagnosticCode =
  | "filesystem_entry_unsupported"
  | "package_json_invalid"
  | "workspace_definition_invalid"
  | "workspace_manager_conflict"
  | "workspace_package_invalid"
  | "workspace_package_duplicate"
  | "config_invalid"
  | "config_reference_missing"
  | "config_path_outside_repository";

export interface DiscoveryDiagnostic {
  code: DiscoveryDiagnosticCode;
  severity: DiagnosticSeverity;
  summary: string;
  path?: string;
  line?: number;
  column?: number;
  typescriptCode?: number;
}

export interface WorkspacePackage {
  id: string;
  directory: string;
  manifestPath: string;
  workspaceMember: boolean;
  name?: string;
  version?: string;
  private?: boolean;
  moduleType?: "module" | "commonjs";
  main?: string;
  types?: string;
  exports?: unknown;
}

export interface WorkspaceDiscovery {
  manager: WorkspaceManager;
  rootManifestPath?: string;
  patterns: string[];
  packages: WorkspacePackage[];
}

export interface CompilerOptionSummary {
  allowJs: boolean;
  checkJs: boolean;
  composite: boolean;
  declaration: boolean;
  noEmit: boolean;
  strict: boolean;
  baseUrl?: string;
  rootDir?: string;
  outDir?: string;
  module?: string;
  moduleResolution?: string;
  target?: string;
  jsx?: string;
  paths: Record<string, string[]>;
}

export interface TypeScriptProject {
  id: string;
  configPath: string;
  configKind: "tsconfig" | "jsconfig";
  packageId?: string;
  language: "typescript" | "javascript" | "mixed" | "empty";
  sourceFiles: string[];
  projectReferences: string[];
  extends: string[];
  resolvedExtends: string[];
  rawFiles: string[];
  rawInclude: string[];
  rawExclude: string[];
  compilerOptions: CompilerOptionSummary;
  diagnostics: DiscoveryDiagnostic[];
  status: DiscoveryStatus;
}

export interface RepositoryProjectDiscovery {
  schemaVersion: "1.0.0";
  repositoryId: string;
  workspace: WorkspaceDiscovery;
  projects: TypeScriptProject[];
  diagnostics: DiscoveryDiagnostic[];
  status: DiscoveryStatus;
}

export interface DiscoverTypeScriptProjectsOptions {
  repositoryRoot: string;
  repositoryId: string;
}

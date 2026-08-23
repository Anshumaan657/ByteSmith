import type { Program } from "typescript";
import type { CanonicalIr } from "@bytesmith/ir";
import type {
  ManifestAnalyzer,
  ManifestUnknown,
} from "@bytesmith/impact-manifest";
import type { Evidence } from "@bytesmith/impact-types";

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

export type CompilerDiagnosticCategory =
  "warning" | "error" | "suggestion" | "message";

export type CompilerDiagnosticPhase =
  "configuration" | "options" | "global" | "syntactic" | "semantic";

export interface CompilerDiagnostic {
  id: string;
  repositoryId: string;
  revision: string;
  projectId: string;
  phase: CompilerDiagnosticPhase;
  code: number;
  category: CompilerDiagnosticCategory;
  summary: string;
  path?: string;
  line?: number;
  column?: number;
}

export type ModuleReferenceKind =
  "import" | "export" | "import_equals" | "require" | "dynamic_import";

export type ModuleResolutionStatus =
  "resolved_internal" | "resolved_external" | "unresolved" | "dynamic";

export interface ModuleReference {
  id: string;
  repositoryId: string;
  revision: string;
  projectId: string;
  fromPath: string;
  kind: ModuleReferenceKind;
  typeOnly: boolean;
  resolution: ModuleResolutionStatus;
  line: number;
  column: number;
  specifier?: string;
  resolvedPath?: string;
  externalPackage?: string;
}

export type CompilerGapType =
  | "configuration_failure"
  | "parse_failure"
  | "type_check_failure"
  | "unresolved_module"
  | "dynamic_import"
  | "reflection"
  | "complex_dependency_injection"
  | "generated_code"
  | "unsupported_signature"
  | "unresolved_symbol";

export interface CompilerGap {
  id: string;
  repositoryId: string;
  revision: string;
  projectId?: string;
  type: CompilerGapType;
  blockingRelevance: "required";
  summary: string;
  path?: string;
  line?: number;
  column?: number;
  diagnosticIds?: string[];
  moduleReferenceId?: string;
  symbolId?: string;
  relationshipId?: string;
}

export type TypeScriptSymbolKind =
  | "function"
  | "method"
  | "interface"
  | "field"
  | "type_alias"
  | "class"
  | "variable";

export type TypeScriptVisibility = "public" | "protected" | "private";

export interface TypeScriptSymbol {
  id: string;
  repositoryId: string;
  revision: string;
  projectId: string;
  path: string;
  name: string;
  qualifiedName: string;
  kind: TypeScriptSymbolKind;
  exported: boolean;
  defaultExport: boolean;
  ambient: boolean;
  visibility: TypeScriptVisibility;
  static: boolean;
  readonly: boolean;
  optional: boolean;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  parentSymbolId?: string;
}

export interface TypeParameterSignature {
  name: string;
  constraint?: string;
  default?: string;
}

export interface ParameterSignature {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
}

export interface CallableSignature {
  typeParameters: TypeParameterSignature[];
  parameters: ParameterSignature[];
  returnType: string;
}

export interface TypeMemberSignature {
  name: string;
  kind: "field" | "method";
  type: string;
  optional: boolean;
  readonly: boolean;
  static: boolean;
  visibility: TypeScriptVisibility;
  signatures: CallableSignature[];
}

export type TypeScriptContractKind =
  "function_signature" | "type_shape" | "variable_type";

export interface TypeScriptContract {
  id: string;
  repositoryId: string;
  revision: string;
  projectId: string;
  symbolId: string;
  name: string;
  kind: TypeScriptContractKind;
  exported: boolean;
  canonicalSignature: string;
  fingerprint: string;
  typeParameters: TypeParameterSignature[];
  signatures: CallableSignature[];
  members: TypeMemberSignature[];
  heritage: string[];
  aliasedType?: string;
  valueType?: string;
}

export type TypeScriptExportKind = "local" | "re_export" | "default";

export interface TypeScriptExport {
  id: string;
  repositoryId: string;
  revision: string;
  projectId: string;
  sourcePath: string;
  exportName: string;
  targetName: string;
  kind: TypeScriptExportKind;
  typeOnly: boolean;
  targetPath?: string;
  targetSymbolId?: string;
  packageId?: string;
}

export interface TypeScriptPackageExport {
  id: string;
  repositoryId: string;
  revision: string;
  packageId: string;
  manifestPath: string;
  packageName?: string;
  subpath: string;
  conditions: string[];
  target: string | null;
}

export type TypeScriptImportKind =
  "default" | "named" | "namespace" | "import_equals";

export interface TypeScriptImportBinding {
  id: string;
  repositoryId: string;
  revision: string;
  projectId: string;
  sourcePath: string;
  localName: string;
  importedName: string;
  kind: TypeScriptImportKind;
  typeOnly: boolean;
  resolution: ModuleResolutionStatus;
  line: number;
  column: number;
  moduleReferenceId?: string;
  targetPath?: string;
  targetSymbolId?: string;
}

export type TypeScriptRelationshipKind = "reference" | "call";

export interface TypeScriptRelationship {
  id: string;
  repositoryId: string;
  revision: string;
  projectId: string;
  kind: TypeScriptRelationshipKind;
  authority: "authoritative";
  fromPath: string;
  toPath: string;
  toName: string;
  toSymbolId: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fromSymbolId?: string;
}

export type SymbolMatchBasis =
  "project_path_qualified_name" | "unique_qualified_name";

export interface CrossRevisionSymbolMatch {
  id: string;
  logicalId: string;
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  baseSymbolId: string;
  headSymbolId: string;
  basis: SymbolMatchBasis;
  moved: boolean;
  signatureChanged: boolean;
}

export interface UnmatchedTypeScriptSymbol {
  symbolId: string;
  side: "base" | "head";
  reason: "removed" | "added" | "ambiguous";
}

export interface CrossRevisionSymbolAnalysis {
  schemaVersion: "1.0.0";
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  matches: CrossRevisionSymbolMatch[];
  unmatched: UnmatchedTypeScriptSymbol[];
}

export interface CompilerProjectAnalysis {
  projectId: string;
  configPath: string;
  sourceFiles: string[];
  rootFileCount: number;
  loadedSourceFileCount: number;
  diagnosticCount: number;
  moduleReferenceCount: number;
  symbolCount: number;
  contractCount: number;
  exportCount: number;
  importBindingCount: number;
  relationshipCount: number;
  gapCount: number;
  status: DiscoveryStatus;
}

export interface TypeScriptCompilerAnalysis {
  schemaVersion: "1.0.0";
  repositoryId: string;
  revision: string;
  compilerVersion: string;
  discoveryStatus: DiscoveryStatus;
  projects: CompilerProjectAnalysis[];
  diagnostics: CompilerDiagnostic[];
  moduleReferences: ModuleReference[];
  symbols: TypeScriptSymbol[];
  contracts: TypeScriptContract[];
  exports: TypeScriptExport[];
  packageExports: TypeScriptPackageExport[];
  importBindings: TypeScriptImportBinding[];
  relationships: TypeScriptRelationship[];
  gaps: CompilerGap[];
  status: DiscoveryStatus;
}

export interface CreateTypeScriptCompilerSessionOptions {
  repositoryRoot: string;
  repositoryId: string;
  revision: string;
  discovery?: RepositoryProjectDiscovery;
}

export interface TypeScriptCompilerSession {
  discovery: RepositoryProjectDiscovery;
  analysis: TypeScriptCompilerAnalysis;
  getProgram(projectId: string): Program | undefined;
}

export interface TypeScriptAnalyzerLimits {
  timeoutMs: number;
  maxOldGenerationSizeMb: number;
  maxProjects: number;
  maxSourceFiles: number;
  maxSymbols: number;
  maxRelationships: number;
  maxDiagnostics: number;
}

export interface TypeScriptAnalyzerSnapshot {
  schemaVersion: "1.0.0";
  configurationId: string;
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  baseSnapshotDigest: string;
  headSnapshotDigest: string;
  analyzerVersion: string;
  baseAnalysis: TypeScriptCompilerAnalysis;
  headAnalysis: TypeScriptCompilerAnalysis;
  symbolAnalysis: CrossRevisionSymbolAnalysis;
  ir: CanonicalIr;
  semanticDigest: { algorithm: "sha256"; value: string };
}

export interface TypeScriptManifestProjection {
  analyzer: ManifestAnalyzer;
  evidence: Evidence[];
  unknowns: ManifestUnknown[];
}

export type AnalyzerFailureKind =
  "timeout" | "worker_crash" | "invalid_input" | "limit_exceeded";

export interface TypeScriptAnalyzerRunResult {
  schemaVersion: "1.0.0";
  execution: "clean" | "incremental";
  status: "completed" | "incomplete" | "error";
  durationMs: number;
  ir: CanonicalIr;
  semanticDigest: { algorithm: "sha256"; value: string };
  canonicalIr: string;
  manifestProjection: TypeScriptManifestProjection;
  diagnostics: string[];
  failureKind?: AnalyzerFailureKind;
  snapshot?: TypeScriptAnalyzerSnapshot;
}

export interface RunTypeScriptAnalyzerOptions {
  repositoryId: string;
  base: { directory: string; revision: string };
  head: { directory: string; revision: string };
  analyzerVersion?: string;
  limits?: Partial<TypeScriptAnalyzerLimits>;
  incrementalSeed?: TypeScriptAnalyzerSnapshot;
}

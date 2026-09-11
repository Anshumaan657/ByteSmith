export type GitObjectId = string;

export interface GitRepository {
  rootPath: string;
  gitDirectory: string;
  commonDirectory: string;
  bare: false;
}

export interface RepositoryRemote {
  name: string;
  url: string;
}

export interface RepositoryIdentity {
  id: string;
  name: string;
  source: "remote" | "history";
  canonicalLocator: string;
  remote?: RepositoryRemote;
}

export type RevisionRole = "base" | "head" | "revision";

export interface ResolvedGitRevision {
  requested: string;
  commit: GitObjectId;
}

export interface ResolvedGitComparison {
  repository: GitRepository;
  identity: RepositoryIdentity;
  base: ResolvedGitRevision;
  head: ResolvedGitRevision;
  mergeBase: GitObjectId;
}

export interface ResolveGitComparisonOptions {
  repositoryPath: string;
  base: string;
  head: string;
}

export interface WorkingTreeState {
  headCommit: GitObjectId;
  branch?: string;
  detached: boolean;
  dirty: boolean;
}

export type GitChangeType =
  "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";

export type GitFileKind =
  "regular" | "executable" | "symlink" | "submodule" | "unknown";

export interface GitChangedFile {
  path: string;
  previousPath?: string;
  changeType: GitChangeType;
  oldMode?: string;
  newMode?: string;
  oldObjectId?: GitObjectId;
  newObjectId?: GitObjectId;
  fileKind: GitFileKind;
  binary: boolean;
  similarity?: number;
}

export interface NormalizedGitDiff {
  fromCommit: GitObjectId;
  toCommit: GitObjectId;
  totalChangedFiles: number;
  files: GitChangedFile[];
}

export interface GitSnapshot {
  directory: string;
  revision: GitObjectId;
  /** Removes the materialized snapshot and its temporary archive. */
  cleanup(): Promise<void>;
}

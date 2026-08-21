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

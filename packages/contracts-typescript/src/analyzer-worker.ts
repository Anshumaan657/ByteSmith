import { parentPort, workerData } from "node:worker_threads";
import { createTypeScriptCompilerSession } from "./compiler.js";
import { matchTypeScriptSymbols } from "./matching.js";
import type {
  CrossRevisionSymbolAnalysis,
  TypeScriptCompilerAnalysis,
} from "./types.js";

interface AnalyzerWorkerData {
  repositoryId: string;
  base: { directory: string; revision: string };
  head: { directory: string; revision: string };
}

interface AnalyzerWorkerSuccess {
  ok: true;
  baseAnalysis: TypeScriptCompilerAnalysis;
  headAnalysis: TypeScriptCompilerAnalysis;
  symbolAnalysis: CrossRevisionSymbolAnalysis;
}

interface AnalyzerWorkerFailure {
  ok: false;
  error: { name: string; code?: string; message: string };
}

async function execute(
  data: AnalyzerWorkerData,
): Promise<AnalyzerWorkerSuccess> {
  const base = await createTypeScriptCompilerSession({
    repositoryRoot: data.base.directory,
    repositoryId: data.repositoryId,
    revision: data.base.revision,
  });
  const head = await createTypeScriptCompilerSession({
    repositoryRoot: data.head.directory,
    repositoryId: data.repositoryId,
    revision: data.head.revision,
  });
  return {
    ok: true,
    baseAnalysis: base.analysis,
    headAnalysis: head.analysis,
    symbolAnalysis: matchTypeScriptSymbols(base.analysis, head.analysis),
  };
}

function failure(error: unknown): AnalyzerWorkerFailure {
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return {
    ok: false,
    error: {
      name: typeof candidate?.name === "string" ? candidate.name : "Error",
      ...(typeof candidate?.code === "string" ? { code: candidate.code } : {}),
      message:
        typeof candidate?.message === "string"
          ? candidate.message
          : "TypeScript analyzer worker failed.",
    },
  };
}

const workerParentPort = parentPort;
if (!workerParentPort) {
  throw new Error("TypeScript analyzer worker requires a parent port.");
}

execute(workerData as AnalyzerWorkerData).then(
  (result) => workerParentPort.postMessage(result),
  (error: unknown) => workerParentPort.postMessage(failure(error)),
);

import { execFile } from "node:child_process";
import os from "node:os";
import { GitError } from "./errors.js";

const defaultTimeoutMs = 15_000;
const defaultMaxBuffer = 4 * 1024 * 1024;

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecFileFailure extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return {
    ...environment,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
}

export async function executeGit(
  directory: string,
  arguments_: readonly string[],
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", directory, ...arguments_],
      {
        encoding: "utf8",
        env: gitEnvironment(),
        maxBuffer: defaultMaxBuffer,
        timeout: defaultTimeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        const failure = error as ExecFileFailure;
        if (failure.code === "ENOENT") {
          reject(
            new GitError(
              "git_unavailable",
              "Git is required but could not be executed.",
              { operation: "execute_git" },
            ),
          );
          return;
        }
        if (failure.killed || failure.signal || failure.code === "ETIMEDOUT") {
          reject(
            new GitError("command_failed", "Git command execution timed out.", {
              operation: "execute_git",
            }),
          );
          return;
        }
        if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          reject(
            new GitError(
              "command_failed",
              "Git command output exceeded the safe limit.",
              {
                operation: "execute_git",
              },
            ),
          );
          return;
        }
        resolve({
          stdout: String(failure.stdout ?? stdout ?? ""),
          stderr: String(failure.stderr ?? stderr ?? ""),
          exitCode: typeof failure.code === "number" ? failure.code : 1,
        });
      },
    );
  });
}

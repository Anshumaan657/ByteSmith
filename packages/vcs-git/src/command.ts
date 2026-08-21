import { spawn } from "node:child_process";
import os from "node:os";
import { GitError } from "./errors.js";

const defaultTimeoutMs = 15_000;
const defaultMaxBuffer = 16 * 1024 * 1024;

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitBinaryCommandResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
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

async function executeGitProcess(
  directory: string,
  arguments_: readonly string[],
): Promise<GitBinaryCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", directory, ...arguments_], {
      env: gitEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, defaultTimeoutMs);

    function collect(target: Buffer[], chunk: Buffer): void {
      outputBytes += chunk.length;
      if (outputBytes > defaultMaxBuffer) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    }

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", (cause: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        cause.code === "ENOENT"
          ? new GitError(
              "git_unavailable",
              "Git is required but could not be executed.",
              {
                operation: "execute_git",
              },
            )
          : new GitError("command_failed", "Git command execution failed.", {
              operation: "execute_git",
            }),
      );
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outputExceeded) {
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
      if (timedOut) {
        reject(
          new GitError("command_failed", "Git command execution timed out.", {
            operation: "execute_git",
          }),
        );
        return;
      }
      if (signal) {
        reject(
          new GitError(
            "command_failed",
            "Git command execution was interrupted.",
            {
              operation: "execute_git",
            },
          ),
        );
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: exitCode ?? 1,
      });
    });
  });
}

export async function executeGitBytes(
  directory: string,
  arguments_: readonly string[],
): Promise<GitBinaryCommandResult> {
  return executeGitProcess(directory, arguments_);
}

export async function executeGit(
  directory: string,
  arguments_: readonly string[],
): Promise<GitCommandResult> {
  const result = await executeGitProcess(directory, arguments_);
  return {
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
    exitCode: result.exitCode,
  };
}

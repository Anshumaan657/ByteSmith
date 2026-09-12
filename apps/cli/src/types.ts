export const EXIT_CODES = {
  pass: 0,
  warn: 1,
  fail: 2,
  incomplete: 3,
  error: 4,
  invalidConfiguration: 5,
  unsupportedSchema: 6,
} as const;

export type OutputFormat = "text" | "json";

export type Command =
  | "init"
  | "doctor"
  | "analyze"
  | "contracts"
  | "test-plan"
  | "verify-impact"
  | "benchmark";

export interface ParsedArguments {
  command: Command;
  repository: string;
  base?: string;
  head?: string;
  manifest?: string;
  config?: string;
  database?: string;
  output?: string;
  fixtures?: string;
  schemas?: string;
  cases?: string[];
  repeat: number;
  format: OutputFormat;
  noColor: boolean;
  noCache: boolean;
}

export interface ErrorEnvelope {
  schemaVersion: "1.0.0";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface OutputWriter {
  stdout(value: string): void;
  stderr(value: string): void;
}

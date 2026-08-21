import { TextDecoder } from "node:util";
import { GitError } from "./errors.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const objectId = "(?:[0-9a-f]{40}|[0-9a-f]{64})";
const rawHeaderPattern = new RegExp(
  `^:([0-7]{6}) ([0-7]{6}) (${objectId}) (${objectId}) ([A-Z])([0-9]{1,3})?$`,
  "u",
);

export interface RawDiffRecord {
  oldMode: string;
  newMode: string;
  oldObjectId: string;
  newObjectId: string;
  status: string;
  similarity?: number;
  path: string;
  previousPath?: string;
}

export interface NumstatRecord {
  path: string;
  previousPath?: string;
  binary: boolean;
}

function parseFailure(message: string): GitError {
  return new GitError("diff_parse_error", message, {
    operation: "parse_git_diff",
  });
}

function splitNullDelimited(output: Buffer): Buffer[] {
  if (output.length === 0) return [];
  if (output.at(-1) !== 0)
    throw parseFailure("Git diff output was not null-terminated.");
  const fields: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    fields.push(output.subarray(start, index));
    start = index + 1;
  }
  return fields;
}

function decode(value: Buffer): string {
  try {
    return decoder.decode(value);
  } catch {
    throw new GitError(
      "diff_path_invalid",
      "Git returned a path that is not valid UTF-8.",
      {
        operation: "parse_git_diff",
      },
    );
  }
}

function requireField(fields: Buffer[], index: number): Buffer {
  const value = fields[index];
  if (!value || value.length === 0)
    throw parseFailure("Git diff output ended before a required path.");
  return value;
}

export function parseRawDiff(output: Buffer): RawDiffRecord[] {
  const fields = splitNullDelimited(output);
  const records: RawDiffRecord[] = [];
  for (let index = 0; index < fields.length;) {
    const header = decode(requireField(fields, index));
    index += 1;
    const match = rawHeaderPattern.exec(header);
    if (!match) throw parseFailure("Git returned malformed raw diff metadata.");
    const [
      ,
      oldMode,
      newMode,
      oldObjectId,
      newObjectId,
      status,
      similarityText,
    ] = match;
    if (!oldMode || !newMode || !oldObjectId || !newObjectId || !status) {
      throw parseFailure("Git returned incomplete raw diff metadata.");
    }
    if (oldObjectId.length !== newObjectId.length) {
      throw parseFailure(
        "Git returned inconsistent object identifier lengths.",
      );
    }
    const needsPreviousPath = status === "R" || status === "C";
    if (needsPreviousPath !== (similarityText !== undefined)) {
      throw parseFailure("Git returned inconsistent rename or copy metadata.");
    }
    const firstPath = decode(requireField(fields, index));
    index += 1;
    const secondPath = needsPreviousPath
      ? decode(requireField(fields, index))
      : undefined;
    if (needsPreviousPath) index += 1;
    const similarity =
      similarityText === undefined ? undefined : Number(similarityText);
    if (
      similarity !== undefined &&
      (!Number.isInteger(similarity) || similarity < 0 || similarity > 100)
    ) {
      throw parseFailure("Git returned an invalid similarity score.");
    }
    records.push({
      oldMode,
      newMode,
      oldObjectId,
      newObjectId,
      status,
      path: secondPath ?? firstPath,
      ...(needsPreviousPath ? { previousPath: firstPath } : {}),
      ...(similarity === undefined ? {} : { similarity }),
    });
  }
  return records;
}

function parseCounts(field: Buffer): { binary: boolean } {
  const firstTab = field.indexOf(9);
  const secondTab = firstTab < 0 ? -1 : field.indexOf(9, firstTab + 1);
  if (firstTab < 1 || secondTab < firstTab + 2)
    throw parseFailure("Git returned malformed numstat metadata.");
  const added = field.subarray(0, firstTab).toString("ascii");
  const deleted = field.subarray(firstTab + 1, secondTab).toString("ascii");
  const binary = added === "-" && deleted === "-";
  if (!binary && (!/^[0-9]+$/u.test(added) || !/^[0-9]+$/u.test(deleted))) {
    throw parseFailure("Git returned invalid numstat counts.");
  }
  if ((added === "-") !== (deleted === "-"))
    throw parseFailure("Git returned inconsistent binary metadata.");
  return { binary };
}

export function parseNumstat(output: Buffer): NumstatRecord[] {
  const fields = splitNullDelimited(output);
  const records: NumstatRecord[] = [];
  for (let index = 0; index < fields.length;) {
    const field = requireField(fields, index);
    index += 1;
    const { binary } = parseCounts(field);
    const secondTab = field.indexOf(9, field.indexOf(9) + 1);
    const inlinePath = field.subarray(secondTab + 1);
    if (inlinePath.length > 0) {
      records.push({ path: decode(inlinePath), binary });
      continue;
    }
    const previousPath = decode(requireField(fields, index));
    const path = decode(requireField(fields, index + 1));
    index += 2;
    records.push({ path, previousPath, binary });
  }
  return records;
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  verifySemanticDigest,
  type ImpactManifest,
} from "@bytesmith/impact-manifest";
import { validateImpactManifest } from "@bytesmith/manifest-validator";

function codedError(code: string, message: string, details?: unknown): Error {
  const error = new Error(message);
  Object.assign(error, {
    code,
    ...(details === undefined ? {} : { details }),
  });
  return error;
}

export async function readManifest(file: string): Promise<ImpactManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown;
  } catch (cause) {
    throw codedError(
      "invalid_manifest",
      `Manifest could not be read: ${cause instanceof Error ? cause.message : "invalid JSON"}.`,
    );
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    parsed.schemaVersion !== "1.0.0"
  ) {
    throw codedError(
      "unsupported_schema",
      `Unsupported Impact Manifest schema version ${String(parsed.schemaVersion)}.`,
    );
  }
  const validation = await validateImpactManifest(parsed);
  if (!validation.valid) {
    throw codedError("invalid_manifest", "Impact Manifest is invalid.", {
      structural: validation.structural.errors,
      semantic: validation.semantic,
    });
  }
  const manifest = parsed as ImpactManifest;
  if (!verifySemanticDigest(manifest)) {
    throw codedError(
      "invalid_manifest",
      "Impact Manifest semantic digest is invalid.",
    );
  }
  return manifest;
}

export async function writeOutputFile(
  file: string,
  contents: string,
): Promise<void> {
  const resolved = path.resolve(file);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, contents, "utf8");
}

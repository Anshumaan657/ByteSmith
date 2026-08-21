import type { ImpactManifest } from "@bytesmith/impact-manifest";
import {
  validateManifestStructure,
  type StructuralValidationResult,
} from "./schema.js";
import {
  validateManifestSemantics,
  type ManifestValidationError,
  type SemanticValidationOptions,
} from "./semantic.js";

export interface ManifestValidationResult {
  valid: boolean;
  structural: StructuralValidationResult;
  semantic: ManifestValidationError[];
}

export async function validateImpactManifest(
  manifest: unknown,
  options?: SemanticValidationOptions,
): Promise<ManifestValidationResult> {
  const structural = await validateManifestStructure(manifest);
  const semantic = structural.valid
    ? validateManifestSemantics(manifest as ImpactManifest, options)
    : [];
  return {
    valid: structural.valid && semantic.length === 0,
    structural,
    semantic,
  };
}

export async function assertImpactManifest(
  manifest: unknown,
  options?: SemanticValidationOptions,
): Promise<void> {
  const result = await validateImpactManifest(manifest, options);
  if (!result.valid) {
    const structural = result.structural.errors.map(
      (error) => `[schema] ${error}`,
    );
    const semantic = result.semantic.map(
      (error) => `${error.path} [${error.code}] ${error.message}`,
    );
    throw new Error([...structural, ...semantic].join("\n"));
  }
}

export * from "./schema.js";
export * from "./semantic.js";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Module, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ImpactManifest } from "@bytesmith/impact-manifest";

export interface StructuralValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ImpactManifestSchemaValidator {
  validate(manifest: unknown): manifest is ImpactManifest;
  errors(): string[];
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? "is invalid"}`;
  });
}

async function readSchema(directory: string, name: string): Promise<object> {
  return JSON.parse(
    await fs.readFile(path.join(directory, name), "utf8"),
  ) as object;
}

export async function createImpactManifestSchemaValidator(
  schemaDirectory = fileURLToPath(new URL("../../../schemas", import.meta.url)),
): Promise<ImpactManifestSchemaValidator> {
  const [impactTypes, impactManifest] = await Promise.all([
    readSchema(schemaDirectory, "impact-types.schema.json"),
    readSchema(schemaDirectory, "impact-manifest.schema.json"),
  ]);
  const Ajv2020 = Ajv2020Module as unknown as new (
    options: Record<string, unknown>,
  ) => {
    addSchema(schema: object): void;
    getSchema(id: string): ValidateFunction<ImpactManifest> | undefined;
  };
  const addFormats = addFormatsModule as unknown as (
    ajv: unknown,
    options?: Record<string, unknown>,
  ) => void;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: true,
  });
  addFormats(ajv, { mode: "full" });
  ajv.addSchema(impactTypes);
  ajv.addSchema(impactManifest);
  const validator = ajv.getSchema(
    "https://bytesmith.dev/schemas/impact-manifest.schema.json",
  );
  if (!validator) throw new Error("Impact Manifest schema did not compile.");
  return {
    validate(manifest: unknown): manifest is ImpactManifest {
      return validator(manifest);
    },
    errors(): string[] {
      return formatErrors(validator.errors);
    },
  };
}

let defaultValidator: Promise<ImpactManifestSchemaValidator> | undefined;

export async function validateManifestStructure(
  manifest: unknown,
): Promise<StructuralValidationResult> {
  defaultValidator ??= createImpactManifestSchemaValidator();
  const validator = await defaultValidator;
  const valid = validator.validate(manifest);
  return { valid, errors: valid ? [] : validator.errors() };
}

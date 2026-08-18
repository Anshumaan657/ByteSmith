import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export async function loadSchemas(root) {
  const directory = path.join(root, "schemas");
  const names = [
    "impact-types.schema.json",
    "impact-manifest.schema.json",
    "changebench-case.schema.json"
  ];
  const schemas = {};
  for (const name of names) {
    schemas[name] = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
  }
  return schemas;
}

export async function createSchemaValidators(root) {
  const schemas = await loadSchemas(root);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: true
  });
  addFormats(ajv, { mode: "full" });

  for (const schema of Object.values(schemas)) ajv.addSchema(schema);

  const validators = {
    manifest: ajv.getSchema(schemas["impact-manifest.schema.json"].$id),
    changebenchCase: ajv.getSchema(schemas["changebench-case.schema.json"].$id)
  };

  if (!validators.manifest || !validators.changebenchCase) {
    throw new Error("Required schema validator was not compiled.");
  }

  return { ajv, schemas, validators };
}

export function formatSchemaErrors(errors = []) {
  return errors.map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message}`;
  });
}

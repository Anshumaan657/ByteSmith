import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LoadedChangeBenchCase, MaterializedCase } from "./types.js";

export async function materializeChangeBenchCase(
  loadedCase: LoadedChangeBenchCase,
): Promise<MaterializedCase> {
  const rootDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), `bytesmith-${loadedCase.definition.id}-`),
  );
  const beforeDirectory = path.join(rootDirectory, "before");
  const afterDirectory = path.join(rootDirectory, "after");
  try {
    await Promise.all([
      fs.cp(loadedCase.beforeDirectory, beforeDirectory, {
        recursive: true,
        errorOnExist: true,
      }),
      fs.cp(loadedCase.afterDirectory, afterDirectory, {
        recursive: true,
        errorOnExist: true,
      }),
    ]);
  } catch (error) {
    await fs.rm(rootDirectory, { recursive: true, force: true });
    throw error;
  }
  return {
    rootDirectory,
    beforeDirectory,
    afterDirectory,
    cleanup: async () => fs.rm(rootDirectory, { recursive: true, force: true }),
  };
}

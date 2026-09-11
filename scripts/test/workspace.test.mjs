import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkspace } from "../validate-workspace.mjs";

test("the active workspace contains only MVP applications and packages", async () => {
  const result = await validateWorkspace();

  assert.deepEqual(result, {
    applications: 2,
    packages: 16,
    workspaces: 18,
    deferredPaths: 20,
  });
});

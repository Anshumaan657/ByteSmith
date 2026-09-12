import assert from "node:assert/strict";
import test from "node:test";

import {
  BYTE_SMITH_CONFIG_VERSION,
  defaultByteSmithConfig,
  normalizeByteSmithConfig,
} from "../dist/index.js";
import { createCacheKey } from "../../storage-sqlite/dist/index.js";

function identity(overrides = {}) {
  return {
    repositoryId: "repository.test",
    baseRevision: "a".repeat(40),
    headRevision: "b".repeat(40),
    mergeBaseRevision: "a".repeat(40),
    engineVersion: "0.1.0",
    analyzerVersions: { "bytesmith.typescript": "0.1.0" },
    ruleSetVersion: "0.1.0",
    schemaVersion: "1.0.0",
    analyzerSetId: "bytesmith-analyzer-set:test",
    configurationDigest: "c".repeat(64),
    ...overrides,
  };
}

test("configuration normalization is strict and produces complete defaults", () => {
  const config = normalizeByteSmithConfig({});
  assert.equal(config.schemaVersion, BYTE_SMITH_CONFIG_VERSION);
  assert.equal(config.analyzers.typescript.enabled, true);
  assert.equal(config.consumerLimits.maxDepth, 8);
  assert.throws(
    () => normalizeByteSmithConfig({ cache: { unsupported: true } }),
    /cache\.unsupported is not supported/u,
  );
});

test("cache identity is canonical and every revision/tool input changes the key", () => {
  const first = createCacheKey(identity());
  const reordered = createCacheKey(
    identity({ analyzerVersions: { "bytesmith.typescript": "0.1.0" } }),
  );
  assert.equal(first.value, reordered.value);
  assert.notEqual(
    first.value,
    createCacheKey(identity({ mergeBaseRevision: "d".repeat(40) })).value,
  );
  assert.notEqual(
    first.value,
    createCacheKey(identity({ configurationDigest: "e".repeat(64) })).value,
  );
});

test("default configuration is safe to clone before init writes it", () => {
  const first = defaultByteSmithConfig();
  const second = structuredClone(first);
  second.consumerLimits.maxDepth = 2;
  assert.equal(first.consumerLimits.maxDepth, 8);
});

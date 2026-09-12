import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SQLiteStore, StorageError, createCacheKey } from "../dist/index.js";
import {
  makeBaseManifest,
  sealManifest,
} from "../../../scripts/test/helpers.mjs";

function identity(overrides = {}) {
  return {
    repositoryId: "repo.bytesmith",
    baseRevision: "base0001",
    headRevision: "head0002",
    mergeBaseRevision: "base0001",
    engineVersion: "0.1.0",
    analyzerVersions: { "bytesmith.typescript": "0.1.0" },
    ruleSetVersion: "0.1.0",
    schemaVersion: "1.0.0",
    analyzerSetId: "bytesmith-analyzer-set:test",
    configurationDigest: "0".repeat(64),
    ...overrides,
  };
}

async function temporaryDatabase(t, prefix = "bytesmith-storage-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, "bytesmith.sqlite");
}

test("SQLite migrations, immutable manifests, history, and cache hits work together", async (t) => {
  const databasePath = await temporaryDatabase(t);
  const manifest = sealManifest(makeBaseManifest());
  const store = await SQLiteStore.open(databasePath);
  const key = await store.putManifest(manifest, identity());
  const repeated = await store.putManifest(manifest, identity());

  assert.equal(key.value, repeated.value);
  assert.equal((await store.getCachedManifest(identity())).state, "hit");
  assert.deepEqual(await store.getManifest(manifest.manifestId), manifest);
  assert.deepEqual(store.listRuns(), [
    {
      manifestId: manifest.manifestId,
      repositoryId: manifest.repository.id,
      baseRevision: manifest.comparison.baseRevision,
      headRevision: manifest.comparison.headRevision,
      mergeBaseRevision: manifest.comparison.mergeBaseRevision,
      configurationDigest: manifest.configurationDigest.value,
      semanticDigest: manifest.integrity.semanticDigest.value,
      createdAt: store.listRuns()[0].createdAt,
    },
  ]);
  assert.deepEqual(store.doctor(), {
    ok: true,
    path: databasePath,
    schemaVersion: 1,
    integrity: "ok",
    runs: 1,
    cacheEntries: 1,
    errors: [],
  });
  assert.equal(store.invalidateCache(identity()), true);
  assert.equal((await store.getCachedManifest(identity())).state, "miss");
  store.close();
});

test("cache identity includes every exact revision and tool input", () => {
  const original = createCacheKey(identity()).value;
  for (const changed of [
    identity({ baseRevision: "different-base" }),
    identity({ headRevision: "different-head" }),
    identity({ mergeBaseRevision: "different-merge-base" }),
    identity({ engineVersion: "0.2.0" }),
    identity({ analyzerVersions: { "bytesmith.typescript": "0.2.0" } }),
    identity({ ruleSetVersion: "0.2.0" }),
    identity({ schemaVersion: "2.0.0" }),
    identity({ analyzerSetId: "bytesmith-analyzer-set:different" }),
    identity({ configurationDigest: "f".repeat(64) }),
  ]) {
    assert.notEqual(createCacheKey(changed).value, original);
  }
});

test("a corrupted cached manifest is deleted and returned as a visible cache miss", async (t) => {
  const databasePath = await temporaryDatabase(t);
  const manifest = sealManifest(makeBaseManifest());
  const store = await SQLiteStore.open(databasePath);
  await store.putManifest(manifest, identity());
  store.close();

  const database = new DatabaseSync(databasePath);
  database
    .prepare(
      "UPDATE bytesmith_runs SET manifest_json = ? WHERE manifest_id = ?",
    )
    .run('{"tampered":true}', manifest.manifestId);
  database.close();

  const reopened = await SQLiteStore.open(databasePath);
  const corrupt = await reopened.getCachedManifest(identity());
  assert.equal(corrupt.state, "corrupt");
  assert.match(corrupt.reason, /identity or digest|invalid/u);
  assert.equal((await reopened.getCachedManifest(identity())).state, "miss");
  await assert.rejects(
    reopened.getManifest(manifest.manifestId),
    (error) =>
      error instanceof StorageError && error.code === "manifest_corrupt",
  );
  reopened.close();
});

test("invalid manifests and divergent duplicate IDs fail before persistence", async (t) => {
  const databasePath = await temporaryDatabase(t);
  const store = await SQLiteStore.open(databasePath);
  const manifest = sealManifest(makeBaseManifest());
  const invalid = structuredClone(manifest);
  invalid.integrity.semanticDigest.value = "f".repeat(64);
  await assert.rejects(
    store.putManifest(invalid, identity()),
    (error) =>
      error instanceof StorageError && error.code === "manifest_invalid",
  );
  await store.putManifest(manifest, identity());
  const divergent = structuredClone(manifest);
  divergent.engine.version = "0.2.0";
  const resealed = sealManifest(divergent);
  await assert.rejects(
    store.putManifest(resealed, identity()),
    (error) =>
      error instanceof StorageError && error.code === "manifest_corrupt",
  );
  store.close();
});

test("a migration checksum mismatch quarantines the database and fails closed", async (t) => {
  const databasePath = await temporaryDatabase(t, "bytesmith-migration-");
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE bytesmith_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL);",
  );
  database
    .prepare(
      "INSERT INTO bytesmith_migrations(version, checksum) VALUES (?, ?)",
    )
    .run(1, "invalid-checksum");
  database.close();

  await assert.rejects(
    SQLiteStore.open(databasePath),
    (error) =>
      error instanceof StorageError && error.code === "database_corrupt",
  );
  const entries = await fs.readdir(path.dirname(databasePath));
  assert.ok(
    entries.some((entry) => entry.startsWith("bytesmith.sqlite.corrupt.")),
  );
});

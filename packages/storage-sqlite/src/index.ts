import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalJson,
  computeSemanticDigest,
} from "@bytesmith/canonicalization";
import {
  serializeImpactManifest,
  verifySemanticDigest,
} from "@bytesmith/impact-manifest";
import type { ImpactManifest } from "@bytesmith/impact-manifest";
import { assertImpactManifest } from "@bytesmith/manifest-validator";

export const SQLITE_SCHEMA_VERSION = 1 as const;

export interface CacheIdentity {
  repositoryId: string;
  baseRevision: string;
  headRevision: string;
  mergeBaseRevision: string;
  engineVersion: string;
  analyzerVersions: Record<string, string>;
  ruleSetVersion: string;
  schemaVersion: string;
  analyzerSetId: string;
  configurationDigest: string;
}

export interface CacheKey {
  value: string;
  identity: CacheIdentity;
}

export interface CacheLookup {
  state: "hit" | "miss" | "corrupt";
  manifest?: ImpactManifest;
  reason?: string;
}

export interface StoreDoctorResult {
  ok: boolean;
  path: string;
  schemaVersion: number;
  integrity: string;
  runs: number;
  cacheEntries: number;
  errors: string[];
}

export type StorageErrorCode =
  | "database_open_failed"
  | "database_corrupt"
  | "migration_failed"
  | "manifest_corrupt"
  | "manifest_invalid"
  | "cache_identity_invalid";

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(
    code: StorageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
  }
}

const migration = `
CREATE TABLE IF NOT EXISTS bytesmith_runs (
  manifest_id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  head_revision TEXT NOT NULL,
  merge_base_revision TEXT NOT NULL,
  configuration_digest TEXT NOT NULL,
  semantic_digest TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bytesmith_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  manifest_id TEXT NOT NULL REFERENCES bytesmith_runs(manifest_id) ON DELETE CASCADE,
  identity_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bytesmith_runs_revision_idx
  ON bytesmith_runs(repository_id, base_revision, head_revision);
`;

function migrationChecksum(): string {
  return createHash("sha256").update(migration, "utf8").digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

function objectRow(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function textColumn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string")
    throw new Error(`SQLite column ${key} is invalid.`);
  return value;
}

function validateIdentity(identity: CacheIdentity): void {
  for (const [key, value] of Object.entries(identity)) {
    if (key === "analyzerVersions") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new StorageError(
          "cache_identity_invalid",
          "Analyzer versions must be an object.",
        );
      }
      for (const [analyzerId, version] of Object.entries(value)) {
        if (
          analyzerId.length === 0 ||
          typeof version !== "string" ||
          version.length === 0
        ) {
          throw new StorageError(
            "cache_identity_invalid",
            "Analyzer IDs and versions must be non-empty text.",
          );
        }
      }
      continue;
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new StorageError(
        "cache_identity_invalid",
        `Cache identity field ${key} is invalid.`,
      );
    }
  }
}

export function createCacheKey(identity: CacheIdentity): CacheKey {
  validateIdentity(identity);
  const normalized = {
    repositoryId: identity.repositoryId,
    baseRevision: identity.baseRevision,
    headRevision: identity.headRevision,
    mergeBaseRevision: identity.mergeBaseRevision,
    engineVersion: identity.engineVersion,
    analyzerVersions: Object.fromEntries(
      Object.entries(identity.analyzerVersions).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    ruleSetVersion: identity.ruleSetVersion,
    schemaVersion: identity.schemaVersion,
    analyzerSetId: identity.analyzerSetId,
    configurationDigest: identity.configurationDigest,
  } satisfies CacheIdentity;
  return {
    value: createHash("sha256")
      .update(canonicalJson(normalized), "utf8")
      .digest("hex"),
    identity: normalized,
  };
}

async function quarantineDatabase(
  databasePath: string,
): Promise<string | undefined> {
  const suffix = `${new Date().toISOString().replaceAll(/[^0-9]/gu, "")}-${process.pid}`;
  const quarantinePath = `${databasePath}.corrupt.${suffix}`;
  try {
    await rename(databasePath, quarantinePath);
    for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
      await rm(sidecar, { force: true });
    }
    return quarantinePath;
  } catch {
    return undefined;
  }
}

export class SQLiteStore {
  readonly databasePath: string;
  private readonly database: DatabaseSync;

  private constructor(databasePath: string, database: DatabaseSync) {
    this.databasePath = databasePath;
    this.database = database;
  }

  static async open(databasePath: string): Promise<SQLiteStore> {
    const resolved = path.resolve(databasePath);
    await mkdir(path.dirname(resolved), { recursive: true });
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(resolved);
      database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
      const store = new SQLiteStore(resolved, database);
      store.migrate();
      return store;
    } catch (cause) {
      try {
        database?.close();
      } catch {
        // The open may have failed before a handle existed.
      }
      await quarantineDatabase(resolved);
      throw new StorageError(
        "database_corrupt",
        "The ByteSmith SQLite database was corrupt or could not be migrated; it was quarantined.",
        { cause },
      );
    }
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS bytesmith_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL);",
    );
    const rows = this.database
      .prepare(
        "SELECT version, checksum FROM bytesmith_migrations ORDER BY version",
      )
      .all() as unknown[];
    const expectedChecksum = migrationChecksum();
    for (const raw of rows) {
      const row = objectRow(raw);
      if (
        !row ||
        row.version !== SQLITE_SCHEMA_VERSION ||
        row.checksum !== expectedChecksum
      ) {
        throw new StorageError(
          "migration_failed",
          "SQLite migration checksum or version is invalid.",
        );
      }
    }
    if (rows.length > 0) return;
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.exec(migration);
      this.database
        .prepare(
          "INSERT INTO bytesmith_migrations(version, checksum) VALUES (?, ?)",
        )
        .run(SQLITE_SCHEMA_VERSION, expectedChecksum);
      this.database.exec("COMMIT;");
    } catch (cause) {
      this.database.exec("ROLLBACK;");
      throw new StorageError(
        "migration_failed",
        "SQLite schema migration failed.",
        { cause },
      );
    }
  }

  async putManifest(
    manifest: ImpactManifest,
    identity: CacheIdentity,
  ): Promise<CacheKey> {
    validateIdentity(identity);
    if (!verifySemanticDigest(manifest)) {
      throw new StorageError(
        "manifest_invalid",
        "Refusing to persist a manifest with an invalid semantic digest.",
      );
    }
    try {
      await assertImpactManifest(manifest);
    } catch (cause) {
      throw new StorageError(
        "manifest_invalid",
        "Refusing to persist an invalid Impact Manifest.",
        { cause },
      );
    }
    const key = createCacheKey(identity);
    const json = serializeImpactManifest(manifest);
    const existing = this.database
      .prepare(
        "SELECT manifest_json, semantic_digest FROM bytesmith_runs WHERE manifest_id = ?",
      )
      .get(manifest.manifestId);
    const existingRow = objectRow(existing);
    if (existingRow) {
      if (
        textColumn(existingRow, "semantic_digest") !==
          manifest.integrity.semanticDigest.value ||
        textColumn(existingRow, "manifest_json") !== json
      ) {
        throw new StorageError(
          "manifest_corrupt",
          "A run ID already exists with different immutable content.",
        );
      }
    }
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO bytesmith_runs
            (manifest_id, repository_id, base_revision, head_revision, merge_base_revision,
             configuration_digest, semantic_digest, manifest_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          manifest.manifestId,
          manifest.repository.id,
          manifest.comparison.baseRevision,
          manifest.comparison.headRevision,
          manifest.comparison.mergeBaseRevision ??
            manifest.comparison.baseRevision,
          manifest.configurationDigest.value,
          manifest.integrity.semanticDigest.value,
          json,
          now(),
        );
      this.database
        .prepare(
          `INSERT INTO bytesmith_cache(cache_key, manifest_id, identity_json, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET manifest_id = excluded.manifest_id,
             identity_json = excluded.identity_json, created_at = excluded.created_at`,
        )
        .run(
          key.value,
          manifest.manifestId,
          JSON.stringify(key.identity),
          now(),
        );
      this.database.exec("COMMIT;");
    } catch (cause) {
      this.database.exec("ROLLBACK;");
      throw new StorageError(
        "database_open_failed",
        "SQLite could not persist the manifest.",
        { cause },
      );
    }
    return key;
  }

  async getCachedManifest(identity: CacheIdentity): Promise<CacheLookup> {
    const key = createCacheKey(identity);
    const row = objectRow(
      this.database
        .prepare(
          `SELECT r.manifest_json, r.semantic_digest, r.repository_id, r.base_revision,
                  r.head_revision, r.merge_base_revision, r.configuration_digest,
                  c.identity_json
           FROM bytesmith_cache c JOIN bytesmith_runs r ON r.manifest_id = c.manifest_id
           WHERE c.cache_key = ?`,
        )
        .get(key.value),
    );
    if (!row) return { state: "miss" };
    try {
      const rawJson = textColumn(row, "manifest_json");
      const manifest = JSON.parse(rawJson) as ImpactManifest;
      if (
        textColumn(row, "semantic_digest") !==
          manifest.integrity?.semanticDigest?.value ||
        computeSemanticDigest(manifest) !==
          manifest.integrity?.semanticDigest?.value ||
        manifest.repository.id !== identity.repositoryId ||
        manifest.comparison.baseRevision !== identity.baseRevision ||
        manifest.comparison.headRevision !== identity.headRevision ||
        manifest.comparison.mergeBaseRevision !== identity.mergeBaseRevision ||
        manifest.configurationDigest.value !== identity.configurationDigest ||
        canonicalJson(JSON.parse(textColumn(row, "identity_json"))) !==
          canonicalJson(key.identity) ||
        !verifySemanticDigest(manifest)
      ) {
        throw new Error("Cached manifest identity or digest does not match.");
      }
      await assertImpactManifest(manifest);
      return { state: "hit", manifest };
    } catch (cause) {
      this.database
        .prepare("DELETE FROM bytesmith_cache WHERE cache_key = ?")
        .run(key.value);
      return {
        state: "corrupt",
        reason:
          cause instanceof Error
            ? cause.message
            : "Cached manifest is invalid.",
      };
    }
  }

  doctor(): StoreDoctorResult {
    const errors: string[] = [];
    let integrity = "unknown";
    try {
      const result = objectRow(
        this.database.prepare("PRAGMA integrity_check").get(),
      );
      integrity =
        typeof result?.integrity_check === "string"
          ? result.integrity_check
          : "unknown";
      if (integrity !== "ok")
        errors.push(`SQLite integrity check returned ${integrity}.`);
    } catch (cause) {
      errors.push(
        cause instanceof Error
          ? cause.message
          : "SQLite integrity check failed.",
      );
    }
    const count = (table: string): number => {
      const result = objectRow(
        this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      );
      return typeof result?.count === "number" ? result.count : 0;
    };
    return {
      ok: errors.length === 0,
      path: this.databasePath,
      schemaVersion: SQLITE_SCHEMA_VERSION,
      integrity,
      runs: count("bytesmith_runs"),
      cacheEntries: count("bytesmith_cache"),
      errors,
    };
  }
}

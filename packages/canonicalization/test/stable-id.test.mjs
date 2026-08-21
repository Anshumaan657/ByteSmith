import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, stableId, verifyStableId } from "../dist/index.js";

test("canonical JSON and stable IDs ignore object declaration order", () => {
  const first = { z: 2, nested: { b: "value", a: true }, a: 1 };
  const second = { a: 1, nested: { a: true, b: "value" }, z: 2 };
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(stableId("record", first), stableId("record", second));
  assert.match(stableId("record", first), /^record:[a-f0-9]{64}$/u);
});

test("canonical strings use NFC while ordered arrays retain their order", () => {
  assert.equal(canonicalJson("cafe\u0301"), canonicalJson("café"));
  assert.notEqual(
    stableId("record", ["a", "b"]),
    stableId("record", ["b", "a"]),
  );
});

test("stable ID verification detects semantic changes", () => {
  const value = { path: "src/app.ts", revision: "a".repeat(40) };
  const id = stableId("file", value);
  assert.equal(verifyStableId(id, "file", value), true);
  assert.equal(
    verifyStableId(id, "file", { ...value, path: "src/other.ts" }),
    false,
  );
});

test("canonicalization rejects non-JSON values, non-finite numbers, and normalized-key collisions", () => {
  for (const invalid of [
    { value: undefined },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { café: 1, "cafe\u0301": 2 },
  ]) {
    assert.throws(() => canonicalJson(invalid), TypeError);
  }
  assert.throws(() => stableId("bad:namespace", {}), TypeError);
});

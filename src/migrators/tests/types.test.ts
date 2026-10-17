/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification and type guard tests for migrator types module.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial types test.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as types from "../types.ts";

test("types module loads without error", () => {
  expect(types).toBeDefined();
});

test("MigrationError is constructable and preserves fields", () => {
  const err = new types.MigrationError("rfc-test", "/path/to/file", "field.path", "test reason");
  expect(err.migratorId).toBe("rfc-test");
  expect(err.filePath).toBe("/path/to/file");
  expect(err.fieldPath).toBe("field.path");
  expect(err.reason).toBe("test reason");
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("rfc-test");
  expect(err.message).toContain("test reason");
});

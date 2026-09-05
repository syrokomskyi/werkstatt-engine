import { test, expect } from "vitest";
import {
  buildCommandResultCacheKey,
  parseCommandResultCacheKey,
  COMMAND_RESULT_CACHE_NAMESPACE,
  type CommandResultCacheKey,
} from "../cache/command-result-cache.ts";
import { deriveModuleBasePath } from "../runtime/registry.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1028: Test composite cache key format, parse round-trip, and
    deriveModuleBasePath resolution logic.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1028: initial tests for composite cache key and deriveModuleBasePath.</item>
</CHANGE_SUMMARY>
*/

test("buildCommandResultCacheKey produces composite string with 5 colon-separated parts", () => {
  const key: CommandResultCacheKey = {
    schemaVersion: 1,
    commandName: "test.check",
    siteName: "my-site",
    inputsHash: "abc123",
    moduleHash: "def456",
  };
  const result = buildCommandResultCacheKey(key);
  expect(result).toBe("1:test.check:my-site:abc123:def456");
});

test("buildCommandResultCacheKey uses empty string for null siteName", () => {
  const key: CommandResultCacheKey = {
    schemaVersion: 2,
    commandName: "workspace.check",
    siteName: null,
    inputsHash: "hash1",
    moduleHash: "hash2",
  };
  const result = buildCommandResultCacheKey(key);
  expect(result).toBe("2:workspace.check::hash1:hash2");
});

test("parseCommandResultCacheKey round-trips for command_results namespace", () => {
  const composite = "1:test.check:my-site:abc123:def456";
  const parsed = parseCommandResultCacheKey(COMMAND_RESULT_CACHE_NAMESPACE, composite);
  expect(parsed).toEqual({
    commandName: "test.check",
    siteName: "my-site",
    inputsHash: "abc123",
    moduleHash: "def456",
  });
});

test("parseCommandResultCacheKey returns null for wrong namespace", () => {
  const composite = "1:test.check:my-site:abc123:def456";
  const parsed = parseCommandResultCacheKey("other_namespace", composite);
  expect(parsed).toBeNull();
});

test("parseCommandResultCacheKey returns null for malformed key", () => {
  const parsed = parseCommandResultCacheKey(COMMAND_RESULT_CACHE_NAMESPACE, "too:short");
  expect(parsed).toBeNull();
});

test("parseCommandResultCacheKey handles null siteName (empty string)", () => {
  const composite = "1:cmd::hash1:hash2";
  const parsed = parseCommandResultCacheKey(COMMAND_RESULT_CACHE_NAMESPACE, composite);
  expect(parsed).toEqual({
    commandName: "cmd",
    siteName: null,
    inputsHash: "hash1",
    moduleHash: "hash2",
  });
});

test("deriveModuleBasePath extracts /src path from modulePath", () => {
  expect(
    deriveModuleBasePath("packages/werkstatt-engine/src/mission/mission.module.ts"),
  ).toBe("packages/werkstatt-engine/src");
});

test("deriveModuleBasePath returns undefined when no /src/ in path", () => {
  expect(deriveModuleBasePath("packages/forge/os/mission.module.ts")).toBeUndefined();
});

test("deriveModuleBasePath handles paths with multiple /src/ segments", () => {
  expect(
    deriveModuleBasePath("packages/werkstatt-site/src/domain/src/helper.ts"),
  ).toBe("packages/werkstatt-site/src");
});

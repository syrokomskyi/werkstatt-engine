/*
<MODULE_CONTRACT>
  <purpose>RFC-0753: unit tests for dns.records.schema.validate command handler.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial schema validate tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runDnsRecordsSchemaValidate } from "./dns-records-schema-validate.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "../kernel/types.ts";
import { tmpdir } from "node:os";

let testRoot: string;
let tmpDir: string;

function resolveCacheDir(systemId: string): string {
  return join(testRoot, "systems-cache", systemId);
}

function resolveDnsPath(systemId: string): string {
  return join(resolveCacheDir(systemId), "dns-records.yaml");
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-dns-schema-validate-"));
  tmpDir = join(testRoot, "workspace");
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function makeInput(flags: Record<string, unknown>): {
  argv: string[];
  flags: Record<string, unknown>;
} {
  return { argv: [], flags };
}

test("schema.validate: valid declaration file passes", async () => {
  mkdirSync(resolveCacheDir("test-system"), { recursive: true });
  writeFileSync(
    resolveDnsPath("test-system"),
    `kind: dns-records
schemaVersion: 1
zone: example.com
updatedAt: "2026-01-01T00:00:00.000Z"
records:
  - name: example.com
    type: A
    content: 192.0.2.1
    proxied: true
`,
  );

  const result = await runDnsRecordsSchemaValidate(
    makeInput({ system: "test-system" }) as unknown as KernelCommandInput,
    { workspaceRoot: tmpDir } as unknown as KernelRuntimeContext,
  );

  expect(result.data!.state).toBe("valid");
  expect(result.data!.files).toHaveLength(1);
  expect(result.data!.files[0].valid).toBe(true);
  expect(result.exitCode).toBeUndefined();
});

test("schema.validate: invalid record type fails", async () => {
  mkdirSync(resolveCacheDir("test-system"), { recursive: true });
  writeFileSync(
    resolveDnsPath("test-system"),
    `kind: dns-records
schemaVersion: 1
zone: example.com
updatedAt: "2026-01-01T00:00:00.000Z"
records:
  - name: example.com
    type: INVALID
    content: 192.0.2.1
`,
  );

  const result = await runDnsRecordsSchemaValidate(
    makeInput({ system: "test-system" }) as unknown as KernelCommandInput,
    { workspaceRoot: tmpDir } as unknown as KernelRuntimeContext,
  );

  expect(result.data!.state).toBe("invalid");
  expect(result.data!.files[0].valid).toBe(false);
  expect(result.data!.files[0].errors).not.toBeNull();
  expect(result.exitCode).toBe(1);
});

test("schema.validate: missing file is skipped (not an error)", async () => {
  const result = await runDnsRecordsSchemaValidate(
    makeInput({ system: "nonexistent" }) as unknown as KernelCommandInput,
    { workspaceRoot: tmpDir } as unknown as KernelRuntimeContext,
  );

  expect(result.data!.state).toBe("valid");
  expect(result.data!.files).toHaveLength(0);
});

test("schema.validate: no --system scans all systems", async () => {
  for (const id of ["sys-a", "sys-b"]) {
    const cacheDir = resolveCacheDir(id);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "system-config.yaml"),
      `schemaVersion: system-config/v1
id: ${id}
cosmicStar: Vega
mirrors:
  - path: ../systems-cache/${id}
    storageType: non-bare
pinnedPlatform: "1.0.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`,
    );
  }
  writeFileSync(
    resolveDnsPath("sys-a"),
    `kind: dns-records
schemaVersion: 1
zone: a.example.com
updatedAt: "2026-01-01T00:00:00.000Z"
records: []
`,
  );
  writeFileSync(
    resolveDnsPath("sys-b"),
    `kind: dns-records
schemaVersion: 1
zone: b.example.com
updatedAt: "2026-01-01T00:00:00.000Z"
records: []
`,
  );

  const result = await runDnsRecordsSchemaValidate(
    makeInput({}) as unknown as KernelCommandInput,
    { workspaceRoot: tmpDir } as unknown as KernelRuntimeContext,
  );

  expect(result.data!.state).toBe("valid");
  expect(result.data!.files).toHaveLength(2);
});

test("schema.validate: invalid schemaVersion fails", async () => {
  mkdirSync(resolveCacheDir("test-system"), { recursive: true });
  writeFileSync(
    resolveDnsPath("test-system"),
    `kind: dns-records
schemaVersion: 2
zone: example.com
updatedAt: "2026-01-01T00:00:00.000Z"
records: []
`,
  );

  const result = await runDnsRecordsSchemaValidate(
    makeInput({ system: "test-system" }) as unknown as KernelCommandInput,
    { workspaceRoot: tmpDir } as unknown as KernelRuntimeContext,
  );

  expect(result.data!.state).toBe("invalid");
  expect(result.exitCode).toBe(1);
});

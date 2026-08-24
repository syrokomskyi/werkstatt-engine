/*
<MODULE_CONTRACT>
<purpose>
ADR-0037: Shared test helper for KernelCommandResult type narrowing. Asserts
that `data` is defined and returns it with the correct type, eliminating
non-null assertions (`result.data!.field`) throughout test files. Provides
both compile-time type narrowing and a runtime guard with a clear error
message instead of a cryptic TypeError.
</purpose>
<non-goals>
  <item>Does not validate the shape of `data` — only asserts its presence. Use zod schemas for structural validation in tests.</item>
  <item>Does not check `exitCode` — callers should assert exit code separately when relevant.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0037: initial expectData helper for KernelCommandResult type narrowing.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandResult } from "@warpgogol/werkstatt-engine/kernel";

export function expectData<T>(result: KernelCommandResult<T>): T {
  if (result.data === undefined) {
    throw new Error(
      `expected result.data to be defined, but it was undefined (summary: ${result.summary ?? "<none>"})`,
    );
  }
  return result.data;
}

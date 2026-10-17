/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for actionspbt — actions.pbt covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0347: initial PBT illustrative example for agent-gate validation invariants.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import { validateAgainstCapabilitySchema } from "../actions.ts";
import type { CapabilityInputOutputSchema } from "@warpgogol/werkstatt-shared/ontology";

const stringSchema: CapabilityInputOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    email: { type: "string", format: "email" },
  },
  required: ["name"],
};

test("PBT: non-object input (string) always fails validation", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1 }), (s) => {
      const result = validateAgainstCapabilitySchema(stringSchema, s);
      expect(result.ok).toBe(false);
    }),
  );
});

test("PBT: non-object input (number) always fails validation", () => {
  fc.assert(
    fc.property(fc.nat(), (n) => {
      const result = validateAgainstCapabilitySchema(stringSchema, n);
      expect(result.ok).toBe(false);
    }),
  );
});

test("PBT: non-object input (array) always fails validation", () => {
  fc.assert(
    fc.property(fc.array(fc.string()), (arr) => {
      const result = validateAgainstCapabilitySchema(stringSchema, arr);
      expect(result.ok).toBe(false);
    }),
  );
});

test("PBT: object with unknown property always reports an error for that property", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }).filter((s) => s !== "name" && s !== "email"),
      (unknownKey) => {
        const result = validateAgainstCapabilitySchema(stringSchema, { [unknownKey]: "value" });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errors.some((e) => e.path === unknownKey)).toBe(true);
        }
      },
    ),
  );
});

test("PBT: object missing required 'name' always reports 'name' as required", () => {
  fc.assert(
    fc.property(fc.option(fc.string({ maxLength: 50 })), (email) => {
      const input: Record<string, unknown> = {};
      if (email !== null) input.email = email;
      const result = validateAgainstCapabilitySchema(stringSchema, input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.path === "name")).toBe(true);
      }
    }),
  );
});

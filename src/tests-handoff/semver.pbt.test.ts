/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for semverpbt — semver.pbt covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0347: initial PBT illustrative example for semver invariants.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import { compareSemver, parseSemver } from "../handoff/semver.ts";

const semverArbitrary = fc
  .tuple(fc.nat({ max: 999 }), fc.nat({ max: 999 }), fc.nat({ max: 999 }))
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

test("PBT: compareSemver is reflexive — compare(a, a) === 0", () => {
  fc.assert(
    fc.property(semverArbitrary, (v) => {
      expect(compareSemver(v, v)).toBe(0);
    }),
  );
});

test("PBT: compareSemver is antisymmetric — compare(a, b) === -compare(b, a)", () => {
  fc.assert(
    fc.property(semverArbitrary, semverArbitrary, (a, b) => {
      expect(compareSemver(a, b)).toBe(-compareSemver(b, a) as -1 | 0 | 1);
    }),
  );
});

test("PBT: compareSemver is transitive — a < b && b < c => a < c", () => {
  fc.assert(
    fc.property(semverArbitrary, semverArbitrary, semverArbitrary, (a, b, c) => {
      const ab = compareSemver(a, b);
      const bc = compareSemver(b, c);
      if (ab < 0 && bc < 0) {
        expect(compareSemver(a, c)).toBe(-1);
      }
    }),
  );
});

test("PBT: parseSemver round-trips — parse(v) reconstructs v", () => {
  fc.assert(
    fc.property(semverArbitrary, (v) => {
      const [major, minor, patch] = parseSemver(v);
      expect(`${major}.${minor}.${patch}`).toBe(v);
    }),
  );
});

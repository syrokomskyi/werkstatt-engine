import { test, expect } from "vitest";
import {
  STERNSYSTEM_ID_REGEX,
  MISSION_ID_REGEX,
  RELEASE_ID_REGEX,
  BORDBUCH_EVENT_ID_REGEX,
  NON_ASCII_REGEX,
  STERNSYSTEM_ID_POLICY,
  MISSION_ID_POLICY,
  RELEASE_ID_POLICY,
  BORDBUCH_EVENT_ID_POLICY,
  isLatinOnly,
  KNOWN_TLDS,
  hasTldSuffix,
} from "../schemas/naming-policy.ts";

// ---------------------------------------------------------------------------
// Sternsystem ID
// ---------------------------------------------------------------------------

test("STERNSYSTEM_ID_REGEX accepts valid kebab-case ids", () => {
  for (const id of STERNSYSTEM_ID_POLICY.examples) {
    expect(STERNSYSTEM_ID_REGEX.test(id)).toBe(true);
  }
  expect(STERNSYSTEM_ID_REGEX.test("a")).toBe(true);
  expect(STERNSYSTEM_ID_REGEX.test("abc")).toBe(true);
  expect(STERNSYSTEM_ID_REGEX.test("a-b-c")).toBe(true);
  expect(STERNSYSTEM_ID_REGEX.test("abc123")).toBe(true);
  expect(STERNSYSTEM_ID_REGEX.test("a1-b2-c3")).toBe(true);
});

test("STERNSYSTEM_ID_REGEX rejects counter-examples", () => {
  for (const id of STERNSYSTEM_ID_POLICY.counterExamples) {
    expect(STERNSYSTEM_ID_REGEX.test(id)).toBe(false);
  }
});

test("STERNSYSTEM_ID_REGEX rejects empty string", () => {
  expect(STERNSYSTEM_ID_REGEX.test("")).toBe(false);
});

test("STERNSYSTEM_ID_REGEX rejects uppercase", () => {
  expect(STERNSYSTEM_ID_REGEX.test("Warpgogol")).toBe(false);
  expect(STERNSYSTEM_ID_REGEX.test("warpgogolCom")).toBe(false);
});

test("STERNSYSTEM_ID_REGEX rejects non-latin", () => {
  expect(STERNSYSTEM_ID_REGEX.test("nicaragüa")).toBe(false);
  expect(STERNSYSTEM_ID_REGEX.test("münchen")).toBe(false);
});

test("STERNSYSTEM_ID_REGEX rejects consecutive hyphens", () => {
  expect(STERNSYSTEM_ID_REGEX.test("a--b")).toBe(false);
});

test("STERNSYSTEM_ID_REGEX rejects hyphen at start or end", () => {
  expect(STERNSYSTEM_ID_REGEX.test("-abc")).toBe(false);
  expect(STERNSYSTEM_ID_REGEX.test("abc-")).toBe(false);
});

// ---------------------------------------------------------------------------
// Mission ID
// ---------------------------------------------------------------------------

test("MISSION_ID_REGEX accepts valid mission ids", () => {
  for (const id of MISSION_ID_POLICY.examples) {
    expect(MISSION_ID_REGEX.test(id)).toBe(true);
  }
  expect(MISSION_ID_REGEX.test("a-m000001")).toBe(true);
  expect(MISSION_ID_REGEX.test("warpgogol-com-m999999")).toBe(true);
});

test("MISSION_ID_REGEX rejects counter-examples", () => {
  for (const id of MISSION_ID_POLICY.counterExamples) {
    expect(MISSION_ID_REGEX.test(id)).toBe(false);
  }
});

test("MISSION_ID_REGEX rejects without -m suffix", () => {
  expect(MISSION_ID_REGEX.test("warpgogol-com")).toBe(false);
});

test("MISSION_ID_REGEX rejects non-zero-padded sequence", () => {
  expect(MISSION_ID_REGEX.test("warpgogol-com-m1")).toBe(false);
  expect(MISSION_ID_REGEX.test("warpgogol-com-m12")).toBe(false);
  expect(MISSION_ID_REGEX.test("warpgogol-com-m1234")).toBe(false);
  expect(MISSION_ID_REGEX.test("warpgogol-com-m12345")).toBe(false);
  expect(MISSION_ID_REGEX.test("warpgogol-com-m1234567")).toBe(false);
});

test("MISSION_ID_REGEX rejects uppercase M", () => {
  expect(MISSION_ID_REGEX.test("warpgogol-com-M000001")).toBe(false);
});

// ---------------------------------------------------------------------------
// Release ID
// ---------------------------------------------------------------------------

test("RELEASE_ID_REGEX accepts valid release ids", () => {
  for (const id of RELEASE_ID_POLICY.examples) {
    expect(RELEASE_ID_REGEX.test(id)).toBe(true);
  }
  expect(RELEASE_ID_REGEX.test("a-r000001")).toBe(true);
  expect(RELEASE_ID_REGEX.test("warpgogol-com-r999999")).toBe(true);
});

test("RELEASE_ID_REGEX rejects counter-examples", () => {
  for (const id of RELEASE_ID_POLICY.counterExamples) {
    expect(RELEASE_ID_REGEX.test(id)).toBe(false);
  }
});

test("RELEASE_ID_REGEX rejects without -r suffix", () => {
  expect(RELEASE_ID_REGEX.test("warpgogol-com")).toBe(false);
});

test("RELEASE_ID_REGEX rejects uppercase R", () => {
  expect(RELEASE_ID_REGEX.test("warpgogol-com-R000001")).toBe(false);
});

// ---------------------------------------------------------------------------
// Bordbuch event ID
// ---------------------------------------------------------------------------

test("BORDBUCH_EVENT_ID_REGEX accepts valid event ids", () => {
  for (const id of BORDBUCH_EVENT_ID_POLICY.examples) {
    expect(BORDBUCH_EVENT_ID_REGEX.test(id)).toBe(true);
  }
  expect(BORDBUCH_EVENT_ID_REGEX.test("event-000000")).toBe(true);
  expect(BORDBUCH_EVENT_ID_REGEX.test("event-999999")).toBe(true);
});

test("BORDBUCH_EVENT_ID_REGEX rejects counter-examples", () => {
  for (const id of BORDBUCH_EVENT_ID_POLICY.counterExamples) {
    expect(BORDBUCH_EVENT_ID_REGEX.test(id)).toBe(false);
  }
});

test("BORDBUCH_EVENT_ID_REGEX rejects without event- prefix", () => {
  expect(BORDBUCH_EVENT_ID_REGEX.test("000001")).toBe(false);
});

test("BORDBUCH_EVENT_ID_REGEX rejects non-six-digit sequence", () => {
  expect(BORDBUCH_EVENT_ID_REGEX.test("event-1")).toBe(false);
  expect(BORDBUCH_EVENT_ID_REGEX.test("event-12")).toBe(false);
  expect(BORDBUCH_EVENT_ID_REGEX.test("event-1234567")).toBe(false);
});

// ---------------------------------------------------------------------------
// isLatinOnly
// ---------------------------------------------------------------------------

test("isLatinOnly returns true for ASCII strings", () => {
  expect(isLatinOnly("hello world")).toBe(true);
  expect(isLatinOnly("warpgogol-com-m000001")).toBe(true);
  expect(isLatinOnly("")).toBe(true);
  expect(isLatinOnly("ABC123xyz-_.")).toBe(true);
});

test("isLatinOnly returns false for non-ASCII strings", () => {
  expect(isLatinOnly("münchen")).toBe(false);
  expect(isLatinOnly("nicaragüa")).toBe(false);
  expect(isLatinOnly("über")).toBe(false);
  expect(isLatinOnly("Клієнт")).toBe(false);
  expect(isLatinOnly("emoji 🎉")).toBe(false);
});

test("NON_ASCII_REGEX matches non-ASCII characters", () => {
  expect(NON_ASCII_REGEX.test("münchen")).toBe(true);
  expect(NON_ASCII_REGEX.test("hello")).toBe(false);
});

// ---------------------------------------------------------------------------
// RFC-0902: hasTldSuffix
// ---------------------------------------------------------------------------

test("hasTldSuffix returns true for IDs ending in a known TLD", () => {
  expect(hasTldSuffix("warpgogol-com")).toBe(true);
  expect(hasTldSuffix("nicaragua-projekt-org")).toBe(true);
  expect(hasTldSuffix("example-de")).toBe(true);
  expect(hasTldSuffix("foo-bar-baz-io")).toBe(true);
  expect(hasTldSuffix("site-dev")).toBe(true);
});

test("hasTldSuffix returns false for IDs without TLD suffix", () => {
  expect(hasTldSuffix("warpgogol")).toBe(false);
  expect(hasTldSuffix("nicaragua-projekt")).toBe(false);
  expect(hasTldSuffix("foo-bar-baz")).toBe(false);
  expect(hasTldSuffix("a-b-c")).toBe(false);
});

test("hasTldSuffix returns false for single-segment IDs", () => {
  expect(hasTldSuffix("com")).toBe(false);
  expect(hasTldSuffix("org")).toBe(false);
  expect(hasTldSuffix("warpgogol")).toBe(false);
  expect(hasTldSuffix("")).toBe(false);
});

test("KNOWN_TLDS contains expected common TLDs", () => {
  expect(KNOWN_TLDS.has("com")).toBe(true);
  expect(KNOWN_TLDS.has("org")).toBe(true);
  expect(KNOWN_TLDS.has("de")).toBe(true);
  expect(KNOWN_TLDS.has("io")).toBe(true);
  expect(KNOWN_TLDS.has("dev")).toBe(true);
});

test("STERNSYSTEM_ID_POLICY examples are TLD-free", () => {
  for (const id of STERNSYSTEM_ID_POLICY.examples) {
    expect(hasTldSuffix(id)).toBe(false);
  }
});

test("STERNSYSTEM_ID_POLICY tldCounterExamples include TLD-suffixed IDs", () => {
  expect(STERNSYSTEM_ID_POLICY.tldCounterExamples).toContain("warpgogol-com");
  expect(STERNSYSTEM_ID_POLICY.tldCounterExamples).toContain("nicaragua-projekt-org");
  for (const id of STERNSYSTEM_ID_POLICY.tldCounterExamples) {
    expect(hasTldSuffix(id)).toBe(true);
  }
});

/*
<MODULE_CONTRACT>
<purpose>RFC-0361: Centralized naming policy regexes and policy descriptors for Sternsystem, Mission, Release, and Bordbuch ids. RFC-0902: add KNOWN_TLDS and hasTldSuffix() for TLD-suffix detection.</purpose>
<non-goals>
  <item>Does not define filename policies — that is DNA-6 / RFC-0360.</item>
  <item>Does not define content-level naming — that is RFC-0047.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0361: initial centralized naming policy regexes and descriptors.</item>
  <item>RFC-0902: add KNOWN_TLDS set and hasTldSuffix() function; update examples to TLD-free IDs.</item>
</CHANGE_SUMMARY>
*/

export const STERNSYSTEM_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MISSION_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*-m\d{6}$/;
export const RELEASE_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*-r\d{6}$/;
export const BORDBUCH_EVENT_ID_REGEX = /^event-\d{6}$/;

export const NON_ASCII_REGEX = /[^\x00-\x7F]/;

// RFC-0902: Known TLD suffixes that must not appear as the last segment of a Sternsystem ID.
// Conservative list — add TLDs as needed. Removing a TLD from this set is a code change, not an RFC.
export const KNOWN_TLDS: ReadonlySet<string> = new Set([
  "com",
  "org",
  "net",
  "de",
  "at",
  "ch",
  "it",
  "fr",
  "es",
  "nl",
  "be",
  "pl",
  "se",
  "no",
  "dk",
  "fi",
  "pt",
  "cz",
  "sk",
  "hu",
  "ro",
  "bg",
  "hr",
  "si",
  "lt",
  "lv",
  "ee",
  "ie",
  "lu",
  "mt",
  "cy",
  "gr",
  "uk",
  "us",
  "ca",
  "au",
  "nz",
  "io",
  "co",
  "ai",
  "dev",
  "app",
  "eu",
  "info",
  "biz",
  "me",
  "tv",
  "gg",
  "to",
  "xyz",
  "site",
  "online",
  "store",
  "shop",
  "blog",
  "cloud",
]);

// RFC-0902: Returns true if the last hyphen-separated segment of the id is a known TLD.
// Single-segment IDs (e.g. "com", "warpgogol") return false — the concern is suffix segments.
export function hasTldSuffix(id: string): boolean {
  const segments = id.split("-");
  if (segments.length < 2) return false;
  return KNOWN_TLDS.has(segments[segments.length - 1]);
}

export const STERNSYSTEM_ID_POLICY = {
  regex: STERNSYSTEM_ID_REGEX,
  charset: "ASCII lowercase letters (a-z), digits (0-9), hyphens (-)",
  description: "kebab-case, lowercase, latin-only",
  examples: ["warpgogol", "nicaragua-projekt"],
  counterExamples: [
    "Warpgogol-Com",
    "nicaragüa-projekt",
    "warpgogol--com",
    "-warpgogol",
    "warpgogol-",
  ],
  tldCounterExamples: ["warpgogol-com", "nicaragua-projekt-org", "example-de"],
} as const;

export const MISSION_ID_POLICY = {
  regex: MISSION_ID_REGEX,
  format: "<system-id>-m<NNNNNN>",
  description: "system id + literal -m + zero-padded six-digit sequence",
  examples: ["warpgogol-m000001", "nicaragua-projekt-m000042"],
  counterExamples: ["warpgogol-com-m1", "warpgogol-com-M000001", "warpgogol-com-m0000001"],
} as const;

export const RELEASE_ID_POLICY = {
  regex: RELEASE_ID_REGEX,
  format: "<system-id>-r<NNNNNN>",
  description: "system id + literal -r + zero-padded six-digit sequence",
  examples: ["warpgogol-r000001", "nicaragua-projekt-r000042"],
  counterExamples: ["warpgogol-com-r1", "warpgogol-com-R000001", "warpgogol-com-r0000001"],
} as const;

export const BORDBUCH_EVENT_ID_POLICY = {
  regex: BORDBUCH_EVENT_ID_REGEX,
  format: "event-<NNNNNN>",
  description: "literal 'event-' + zero-padded six-digit sequence",
  examples: ["event-000001", "event-000042"],
  counterExamples: ["event-1", "event-0000001", "EVENT-000001"],
} as const;

export function isLatinOnly(value: string): boolean {
  return !NON_ASCII_REGEX.test(value);
}

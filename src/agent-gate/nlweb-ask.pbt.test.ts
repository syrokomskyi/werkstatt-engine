/*
<MODULE_CONTRACT>
  <purpose>RFC-1165 / DNA-101: property-based tests for the pure helpers of the
  NLWeb /ask core — invariants over arbitrary inputs, not hand-picked cases.</purpose>
  <responsibilities>
    <item>resolveAcceptLanguage: output always within supported ∪ {default}; deterministic; undefined → default.</item>
    <item>nlwebMirrorPath: output ends .jsonld, no leading slash, root → index.jsonld; deterministic.</item>
    <item>parseNlwebRequest: never throws on arbitrary input; status always 400 on failure; valid requests round-trip trimmed text.</item>
    <item>noAnswerSentence: always non-empty for arbitrary lang tokens; deterministic.</item>
    <item>nlwebQueryId: 16-hex chars; deterministic per (site, lang, text); input-sensitive.</item>
  </responsibilities>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1165: created — PBT coverage for nlweb-ask pure helpers (fo-review DNA-101 follow-up).</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe } from "vitest";
import fc from "fast-check";
import {
  nlwebMirrorPath,
  nlwebQueryId,
  noAnswerSentence,
  parseNlwebRequest,
  resolveAcceptLanguage,
} from "./nlweb-ask.ts";

const SUPPORTED = ["de", "uk", "en"];
const DEFAULT = "de";

describe("resolveAcceptLanguage — PBT", () => {
  test("always resolves into supported ∪ {default} for arbitrary headers", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (header) => {
        const resolved = resolveAcceptLanguage(header, SUPPORTED, DEFAULT);
        expect([...SUPPORTED, DEFAULT]).toContain(resolved);
      }),
    );
  });

  test("undefined and empty headers resolve to the default language", () => {
    fc.assert(
      fc.property(fc.constantFrom(undefined, "", "   ", " , , q=9"), (header) => {
        expect(resolveAcceptLanguage(header, SUPPORTED, DEFAULT)).toBe(DEFAULT);
      }),
    );
  });

  test("deterministic: same header resolves the same language", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (header) => {
        expect(resolveAcceptLanguage(header, SUPPORTED, DEFAULT)).toBe(
          resolveAcceptLanguage(header, SUPPORTED, DEFAULT),
        );
      }),
    );
  });

  test("a supported tag is honoured regardless of surrounding qualifiers", () => {
    fc.assert(
      fc.property(fc.constantFrom("uk", "uk-UA", "uk;q=0.9", "en;q=0.1,uk;q=0.7"), (header) => {
        expect(resolveAcceptLanguage(header, SUPPORTED, DEFAULT)).toBe("uk");
      }),
    );
  });
});

describe("nlwebMirrorPath — PBT", () => {
  test("always ends in .jsonld and never starts with a slash", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 40 }), (route) => {
        const p = nlwebMirrorPath(route);
        expect(p.endsWith(".jsonld")).toBe(true);
        expect(p.startsWith("/")).toBe(false);
      }),
    );
  });

  test("deterministic and root-shaped inputs collapse to index.jsonld", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 40 }), (route) => {
        expect(nlwebMirrorPath(route)).toBe(nlwebMirrorPath(route));
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.constant("/"), { minLength: 1, maxLength: 5 }), (slashes) => {
        expect(nlwebMirrorPath(slashes.join(""))).toBe("index.jsonld");
      }),
    );
  });
});

describe("parseNlwebRequest — PBT", () => {
  test("never throws on arbitrary input; failures are always status 400", () => {
    fc.assert(
      fc.property(fc.anything(), (body) => {
        const r = parseNlwebRequest(body, "warpgogol");
        if (!r.ok) expect(r.status).toBe(400);
      }),
    );
  });

  test("valid text + matching/undefined site always parses ok and trims", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 2, maxLength: 200 }).filter((s) => s.trim().length >= 2),
        fc.option(fc.constant("warpgogol"), { nil: undefined }),
        (text, site) => {
          const body = { query: { text: ` ${text} `, site }, prefer: { streaming: false } };
          const r = parseNlwebRequest(body, "warpgogol");
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.request.query.text).toBe(text.trim());
        },
      ),
    );
  });

  test("any mismatched site always fails with site-mismatch", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== "warpgogol"),
        (site) => {
          const r = parseNlwebRequest({ query: { text: "Was baut ihr?", site } }, "warpgogol");
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.reason).toBe("site-mismatch");
        },
      ),
    );
  });
});

describe("noAnswerSentence — PBT", () => {
  test("always returns a non-empty string for arbitrary lang tokens", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 8 }), (lang) => {
        const s = noAnswerSentence(lang);
        expect(typeof s).toBe("string");
        expect(s.length).toBeGreaterThan(0);
      }),
    );
  });

  test("deterministic; unknown languages fall back to the English sentence", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 8 }), (lang) => {
        expect(noAnswerSentence(lang)).toBe(noAnswerSentence(lang));
      }),
    );
    expect(noAnswerSentence("xx")).toBe(noAnswerSentence("en"));
  });
});

describe("nlwebQueryId — PBT", () => {
  test("16-hex chars; deterministic per (site, lang, text); input-sensitive", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 4 }),
        fc.string({ minLength: 2, maxLength: 100 }),
        async (site, lang, text) => {
          const a = await nlwebQueryId(site, lang, text);
          const b = await nlwebQueryId(site, lang, text);
          expect(a).toBe(b);
          expect(a).toMatch(/^[0-9a-f]{16}$/);
          const changed = await nlwebQueryId(site, lang, `${text}!`);
          expect(changed).not.toBe(a);
        },
      ),
    );
  });
});

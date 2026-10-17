/*
<MODULE_CONTRACT>
<purpose>
Unit tests for htmlpbt — html.pbt covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the html.pbt suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import { hashHtml } from "../normalizers/html.ts";

const safeText = fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[<>&"']/g, "x"));

const safeAttrName = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => s.replace(/[^a-zA-Z-]/g, "x"));

test("PBT: hashHtml is deterministic — same input always produces same hash", () => {
  fc.assert(
    fc.property(safeText, (html) => {
      expect(hashHtml(html)).toBe(hashHtml(html));
    }),
  );
});

test("PBT: hashHtml always returns sha256 format", () => {
  fc.assert(
    fc.property(safeText, (html) => {
      expect(hashHtml(html)).toMatch(/^sha256:[0-9a-f]{64}$/);
    }),
  );
});

test("PBT: whitespace-only differences between tags produce the same hash", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          tag: fc.constantFrom("div", "span", "p", "h1", "h2", "ul", "li"),
          text: safeText,
        }),
        { minLength: 2, maxLength: 5 },
      ),
      (elements) => {
        const compact = elements.map((e) => `<${e.tag}>${e.text}</${e.tag}>`).join("");
        const spaced = elements.map((e) => `<${e.tag}>${e.text}</${e.tag}>`).join("\n  \n  ");
        expect(hashHtml(compact)).toBe(hashHtml(spaced));
      },
    ),
  );
});

test("PBT: data-* attributes (except data-testid) don't affect the hash", () => {
  fc.assert(
    fc.property(
      fc.record({
        tag: fc.constantFrom("div", "span", "p"),
        attr: safeAttrName.map((s) => `data-${s}`),
        value: safeText,
        text: safeText,
      }),
      ({ tag, attr, value, text }) => {
        const withAttr = `<${tag} ${attr}="${value}">${text}</${tag}>`;
        const withoutAttr = `<${tag}>${text}</${tag}>`;
        expect(hashHtml(withAttr)).toBe(hashHtml(withoutAttr));
      },
    ),
  );
});

test("PBT: comments don't affect the hash", () => {
  fc.assert(
    fc.property(
      fc.record({
        html: safeText,
        comment: safeText,
      }),
      ({ html, comment }) => {
        const withComment = `<!--${comment}-->${html}`;
        expect(hashHtml(withComment)).toBe(hashHtml(html));
      },
    ),
  );
});

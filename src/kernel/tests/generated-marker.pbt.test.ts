/*
<MODULE_CONTRACT>
  <purpose>ADR-0019: property-based tests for stripGeneratedMarker — structural
  invariance across arbitrary HTML/CSS inputs.</purpose>
  <keywords>ADR-0019, PBT, fast-check, generated-marker, stripGeneratedMarker, tag balance, comment isolation, idempotency</keywords>
  <responsibilities>
    <item>Verify tag balance preservation: balanced structural tags in input remain balanced in output.</item>
    <item>Verify comment isolation: non-marker comments and non-comment content are preserved.</item>
    <item>Verify idempotency: strip(strip(x)) === strip(x).</item>
    <item>Verify no content creation: output does not contain HTML tags not present in input.</item>
  </responsibilities>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="pbt-generated-marker">Property-based tests for stripGeneratedMarker structural invariance.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>ADR-0019: initial PBT tests for stripGeneratedMarker — 4 properties.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import {
  GENERATED_MARKER,
  hasGeneratedMarker,
  stripGeneratedMarker,
  buildGeneratedHeader,
} from "../generated-marker.ts";

// ---------------------------------------------------------------------------
// Arbitraries — generate valid-ish HTML with tags, comments, and text
// ---------------------------------------------------------------------------

const STRUCTURAL_TAGS = [
  "div",
  "span",
  "p",
  "main",
  "section",
  "article",
  "header",
  "footer",
  "ul",
  "li",
] as const;

const textSegment = fc
  .string({ minLength: 0, maxLength: 50 })
  .filter(
    (s) =>
      !s.includes("<!--") &&
      !s.includes("-->") &&
      !s.includes(GENERATED_MARKER) &&
      !s.includes("<") &&
      !s.includes(">"),
  );

const commentWithoutMarker = fc.tuple(textSegment).map(([text]) => `<!-- ${text} -->`);

const generatedHeaderHtml = fc.constant(
  buildGeneratedHeader({ filePath: "public/index.md", ownerCommand: "page.markdown.generate" }),
);

const generatedHeaderCss = fc.constant(
  buildGeneratedHeader({
    filePath: "src/styles/biome.generated.css",
    ownerCommand: "biome.css.generate",
  }),
);

const balancedTag = fc
  .tuple(fc.constantFrom(...STRUCTURAL_TAGS), textSegment)
  .map(([tag, text]) => `<${tag}>${text}</${tag}>`);

const htmlSegment = fc.oneof(textSegment, commentWithoutMarker, balancedTag);

const htmlWithMarkerComment = fc
  .tuple(
    fc.array(htmlSegment, { minLength: 0, maxLength: 8 }),
    generatedHeaderHtml,
    fc.array(htmlSegment, { minLength: 0, maxLength: 3 }),
  )
  .map(([before, header, after]) => [...before, header, ...after].join("\n"));

const htmlWithMultipleComments = fc
  .tuple(
    fc.array(commentWithoutMarker, { minLength: 1, maxLength: 3 }),
    generatedHeaderHtml,
    fc.array(commentWithoutMarker, { minLength: 1, maxLength: 3 }),
    fc.array(balancedTag, { minLength: 1, maxLength: 3 }),
  )
  .map(([beforeComments, header, afterComments, tags]) =>
    [...beforeComments, header, ...afterComments, ...tags].join("\n"),
  );

// ---------------------------------------------------------------------------
// Property 1: Tag balance preservation
// ---------------------------------------------------------------------------

function countTagOccurrences(html: string, tag: string): number {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`</${tag}>`, "gi");
  return (html.match(openRe) ?? []).length + (html.match(closeRe) ?? []).length;
}

test("PBT: stripGeneratedMarker preserves tag balance — structural tags in input remain in output", () => {
  fc.assert(
    fc.property(htmlWithMarkerComment, (input) => {
      const { content: output } = stripGeneratedMarker(input);
      for (const tag of STRUCTURAL_TAGS) {
        const inputCount = countTagOccurrences(input, tag);
        const outputCount = countTagOccurrences(output, tag);
        expect(outputCount).toBe(inputCount);
      }
    }),
  );
});

// ---------------------------------------------------------------------------
// Property 2: Comment isolation
// ---------------------------------------------------------------------------

test("PBT: stripGeneratedMarker preserves non-marker comments and non-comment content", () => {
  fc.assert(
    fc.property(htmlWithMultipleComments, (input) => {
      const { content: output } = stripGeneratedMarker(input);

      // Marker is removed
      expect(hasGeneratedMarker(output)).toBe(false);

      // All non-marker comments' text content is preserved
      const commentRe = /<!--([\s\S]*?)-->/g;
      let match: RegExpExecArray | null;
      const inputComments: string[] = [];
      while ((match = commentRe.exec(input)) !== null) {
        const inner = match[1].trim();
        if (!inner.includes(GENERATED_MARKER)) {
          inputComments.push(inner);
        }
      }
      for (const commentText of inputComments) {
        expect(output).toContain(commentText);
      }

      // All balanced tags from input are preserved in output
      const tagRe = /<(div|span|p|main|section|article|header|footer|ul|li)\b[^>]*>/gi;
      const inputTags: string[] = [];
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = tagRe.exec(input)) !== null) {
        inputTags.push(tagMatch[0]);
      }
      for (const tag of inputTags) {
        expect(output).toContain(tag);
      }
    }),
  );
});

// ---------------------------------------------------------------------------
// Property 3: Idempotency
// ---------------------------------------------------------------------------

test("PBT: stripGeneratedMarker is idempotent — strip(strip(x)) === strip(x)", () => {
  fc.assert(
    fc.property(htmlWithMarkerComment, (input) => {
      const once = stripGeneratedMarker(input);
      const twice = stripGeneratedMarker(once.content);
      expect(twice.content).toBe(once.content);
      expect(twice.changed).toBe(false);
    }),
  );
});

// Also test idempotency with CSS comment markers
test("PBT: stripGeneratedMarker is idempotent with CSS block comments", () => {
  fc.assert(
    fc.property(
      fc
        .tuple(fc.array(textSegment, { minLength: 0, maxLength: 3 }), generatedHeaderCss)
        .map(([segments, header]) => [...segments, header, ...segments].join("\n")),
      (input) => {
        const once = stripGeneratedMarker(input);
        const twice = stripGeneratedMarker(once.content);
        expect(twice.content).toBe(once.content);
      },
    ),
  );
});

// ---------------------------------------------------------------------------
// Property 4: No content creation
// ---------------------------------------------------------------------------

test("PBT: stripGeneratedMarker does not create HTML tags not present in input", () => {
  fc.assert(
    fc.property(htmlWithMarkerComment, (input) => {
      const { content: output } = stripGeneratedMarker(input);

      // Extract all tag names from input and output
      const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b/g;
      const inputTagNames = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(input)) !== null) {
        inputTagNames.add(m[1].toLowerCase());
      }
      const outputTagNames = new Set<string>();
      while ((m = tagRe.exec(output)) !== null) {
        outputTagNames.add(m[1].toLowerCase());
      }

      // Every tag in output must exist in input
      for (const tag of outputTagNames) {
        expect(inputTagNames.has(tag)).toBe(true);
      }
    }),
  );
});

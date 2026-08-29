import { test, expect } from "vitest";
import {
  GENERATED_MARKER,
  EDITABLE_GENERATED_MARKER,
  buildGeneratedHeader,
  hasGeneratedMarker,
  stripGeneratedMarker,
} from "../generated-marker.ts";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-0336: unit tests for buildGeneratedHeader() and the extended
  stripGeneratedMarker() advisory-block round trip, across the four comment
  styles generators use (.ts line-slash, .txt line-hash, .md block-html,
  .css block-css).
</purpose>
<keywords>RFC-0336, generated marker, advisory header, strip, round-trip</keywords>
<responsibilities>
  <item>Assert buildGeneratedHeader() picks the right comment syntax per extension.</item>
  <item>Assert stripGeneratedMarker() removes the full block and reports changed: true.</item>
  <item>Assert hasGeneratedMarker() still detects the block via the plain marker substring.</item>
</responsibilities>
<non-goals>
  <item>Do not test individual generator call sites — see each generator's own test file.</item>
</non-goals>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="round-trip tests">One per comment style plus a legacy single-line compatibility check.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0336: initial implementation.</item>
</CHANGE_SUMMARY>
*/

test("buildGeneratedHeader: .ts uses line-slash comments", () => {
  const header = buildGeneratedHeader({
    filePath: "tools/kernel.config.ts",
    ownerCommand: "kernel.wire",
    site: "warpgogol-com",
  });
  expect(header.startsWith(`// ${GENERATED_MARKER}\n`)).toBeTruthy();
  expect(header).toMatch(/^\/\/ Owner command: kernel\.wire$/m);
  expect(header).toMatch(
    /^\/\/ Regenerate:   pnpm exec werkstatt run kernel\.wire --site warpgogol-com$/m,
  );
  expect(hasGeneratedMarker(header)).toBeTruthy();
});

test("buildGeneratedHeader: .txt uses line-hash comments", () => {
  const header = buildGeneratedHeader({
    filePath: "public/robots.txt",
    ownerCommand: "robots.generate",
  });
  expect(header.startsWith(`# ${GENERATED_MARKER}\n`)).toBeTruthy();
  expect(header).toMatch(/^# Regenerate:   pnpm exec werkstatt run robots\.generate$/m);
});

test("buildGeneratedHeader: .gitattributes uses line-hash comments", () => {
  const header = buildGeneratedHeader({
    filePath: ".gitattributes",
    ownerCommand: "gitattributes.generate",
  });
  expect(header.startsWith(`# ${GENERATED_MARKER}\n`)).toBeTruthy();
  expect(header).toMatch(/^# Owner command: gitattributes\.generate$/m);
  expect(header).not.toContain("// Owner command");
});

test("buildGeneratedHeader: .md uses one HTML block comment", () => {
  const header = buildGeneratedHeader({
    filePath: "public/index.md",
    ownerCommand: "page.markdown.generate",
    site: "nicaragua-projekt",
  });
  expect(header.startsWith("<!--\n")).toBeTruthy();
  expect(header.trimEnd().endsWith("-->")).toBeTruthy();
  expect(header.includes(GENERATED_MARKER)).toBeTruthy();
  expect((header.match(/<!--/g) ?? []).length).toBe(1);
});

test("buildGeneratedHeader: .css uses one block comment", () => {
  const header = buildGeneratedHeader({
    filePath: "src/styles/biome.generated.css",
    ownerCommand: "biome.css.generate",
    templatePath: "packages/werkstatt-site/src/codegen/biome-css.ts",
  });
  expect(header.startsWith("/*\n")).toBeTruthy();
  expect(header.trimEnd().endsWith("*/")).toBeTruthy();
  expect(header).toMatch(/Edit instead: packages\/werkstatt-site\/src\/codegen\/biome-css\.ts/);
});

test("stripGeneratedMarker removes the full line-comment advisory block", () => {
  const header = buildGeneratedHeader({
    filePath: "tools/kernel.config.ts",
    ownerCommand: "kernel.wire",
  });
  const content = `${header}import { defineKernelConfig } from "@warpgogol/werkstatt-engine/kernel";\n`;
  const { changed, content: stripped } = stripGeneratedMarker(content);
  expect(changed).toBe(true);
  expect(hasGeneratedMarker(stripped)).toBe(false);
  expect(stripped).toBe(
    'import { defineKernelConfig } from "@warpgogol/werkstatt-engine/kernel";\n',
  );
});

test("stripGeneratedMarker removes the full HTML block advisory header", () => {
  const header = buildGeneratedHeader({
    filePath: "public/index.md",
    ownerCommand: "page.markdown.generate",
  });
  const content = `${header}# Home\n\nBody text.\n`;
  const { changed, content: stripped } = stripGeneratedMarker(content);
  expect(changed).toBe(true);
  expect(hasGeneratedMarker(stripped)).toBe(false);
  expect(stripped).toBe("# Home\n\nBody text.\n");
});

test("stripGeneratedMarker removes the full CSS block advisory header", () => {
  const header = buildGeneratedHeader({
    filePath: "src/styles/biome.generated.css",
    ownerCommand: "biome.css.generate",
  });
  const content = `${header}:root { --color: red; }\n`;
  const { changed, content: stripped } = stripGeneratedMarker(content);
  expect(changed).toBe(true);
  expect(hasGeneratedMarker(stripped)).toBe(false);
  expect(stripped).toBe(":root { --color: red; }\n");
});

test("stripGeneratedMarker still strips the legacy plain single-line marker", () => {
  const content = `// ${GENERATED_MARKER}\nconst x = 1;\n`;
  const { changed, content: stripped } = stripGeneratedMarker(content);
  expect(changed).toBe(true);
  expect(stripped).toBe("const x = 1;\n");
});

test("stripGeneratedMarker does not swallow content between separate HTML comments", () => {
  const header = buildGeneratedHeader({
    filePath: "public/index.md",
    ownerCommand: "page.markdown.generate",
  });
  const content = `<!--\n  GrowthProvider injects two things.\n-->\n<main id="main-content">${header}<p>Body</p></main>\n`;
  const { changed, content: stripped } = stripGeneratedMarker(content);
  expect(changed).toBe(true);
  expect(hasGeneratedMarker(stripped)).toBe(false);
  expect(stripped).toContain('<main id="main-content">');
  expect(stripped).toContain("<p>Body</p></main>");
  expect(stripped).toContain("GrowthProvider injects two things.");
});

test("stripGeneratedMarker does not swallow content between separate CSS comments", () => {
  const header = buildGeneratedHeader({
    filePath: "src/styles/biome.generated.css",
    ownerCommand: "biome.css.generate",
  });
  const content = `/* unrelated comment */\n:root { --color: red; }\n${header}.foo { color: blue; }\n`;
  const { changed, content: stripped } = stripGeneratedMarker(content);
  expect(changed).toBe(true);
  expect(hasGeneratedMarker(stripped)).toBe(false);
  expect(stripped).toContain("unrelated comment");
  expect(stripped).toContain(":root { --color: red; }");
  expect(stripped).toContain(".foo { color: blue; }");
});

test("buildGeneratedHeader without templatePath names the owner command as the edit target", () => {
  const header = buildGeneratedHeader({
    filePath: "src/pages/api/mcp.ts",
    ownerCommand: "api.routes.generate",
  });
  expect(header).toMatch(
    /Edit instead: the api\.routes\.generate generator source \(not this file\)\.$/m,
  );
});

test("buildGeneratedHeader with editable: true uses permissive marker and advisory", () => {
  const header = buildGeneratedHeader({
    filePath: "AGENTS.md",
    ownerCommand: "forge.agents.generate",
    editable: true,
  });
  expect(header).toContain(EDITABLE_GENERATED_MARKER);
  expect(header).not.toContain(GENERATED_MARKER);
  expect(header).not.toContain("DO NOT EDIT");
  expect(hasGeneratedMarker(header)).toBe(true);
});

test("stripGeneratedMarker removes the full editable HTML block advisory header", () => {
  const header = buildGeneratedHeader({
    filePath: "AGENTS.md",
    ownerCommand: "forge.agents.generate",
    editable: true,
  });
  const content = `${header}# Agent Guide\n\nBody text.\n`;
  const { changed, content: stripped } = stripGeneratedMarker(content);
  expect(changed).toBe(true);
  expect(hasGeneratedMarker(stripped)).toBe(false);
  expect(stripped).toBe("# Agent Guide\n\nBody text.\n");
});

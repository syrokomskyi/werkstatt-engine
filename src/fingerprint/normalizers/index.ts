/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Dispatcher that selects the correct normalizer based on file extension.</purpose>
<non-goals>
  <item>Do not implement individual normalizers — each lives in its own file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial dispatcher.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { normalizeTypeScript } from "./typescript.ts";
import { normalizeAstro } from "./astro.ts";
import { normalizeCss } from "./css.ts";
import { normalizeJson } from "./json.ts";
import { normalizeJsonc } from "./jsonc.ts";
import { normalizeYaml } from "./yaml.ts";
import { normalizeMarkdown } from "./markdown.ts";
import { normalizeText } from "./text.ts";
import { hashHtml } from "./html.ts";

export interface NormalizeResult {
  normalizer: string;
  hash: string;
}

interface NormalizerEntry {
  readonly normalizer: string;
  readonly extensions: ReadonlySet<string>;
  normalize(content: string): string | Promise<string>;
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs"]);
const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);
const MD_EXTENSIONS = new Set([".md", ".mdx"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

const REGISTRY: ReadonlyArray<NormalizerEntry> = [
  { normalizer: "typescript", extensions: TS_EXTENSIONS, normalize: normalizeTypeScript },
  { normalizer: "astro", extensions: new Set([".astro"]), normalize: normalizeAstro },
  { normalizer: "css", extensions: new Set([".css"]), normalize: normalizeCss },
  { normalizer: "html", extensions: HTML_EXTENSIONS, normalize: hashHtml },
  { normalizer: "json", extensions: new Set([".json"]), normalize: normalizeJson },
  { normalizer: "jsonc", extensions: new Set([".jsonc"]), normalize: normalizeJsonc },
  { normalizer: "yaml", extensions: YAML_EXTENSIONS, normalize: normalizeYaml },
  { normalizer: "markdown", extensions: MD_EXTENSIONS, normalize: normalizeMarkdown },
];

export async function normalizeFile(absPath: string, bytes: Uint8Array): Promise<NormalizeResult> {
  const ext = path.extname(absPath).toLowerCase();
  const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  try {
    for (const entry of REGISTRY) {
      if (entry.extensions.has(ext)) {
        return { normalizer: entry.normalizer, hash: await entry.normalize(content) };
      }
    }
  } catch {
    // fall through to text normalizer
  }

  return { normalizer: "text", hash: normalizeText(content) };
}

export { normalizeBinary } from "./binary.ts";

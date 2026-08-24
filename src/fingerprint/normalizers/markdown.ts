/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Markdown normalizer using unified + remark-parse — strip HTML comments outside code fences, normalize whitespace.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial Markdown normalizer.</item>
</CHANGE_SUMMARY>
*/

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { byteHash } from "../primitives.ts";

function stripHtmlCommentsOutsideCodeFences(text: string): string {
  const lines = text.split("\n");
  let inCodeFence = false;
  const result: string[] = [];
  for (const line of lines) {
    if (/^(\s{0,3})(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (!inCodeFence) {
      result.push(line.replace(/<!--[\s\S]*?-->/g, ""));
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

export function normalizeMarkdown(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const stripped = stripHtmlCommentsOutsideCodeFences(normalized);
  const tree = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx).parse(stripped);
  const serialized = JSON.stringify(tree, (key, value) => {
    if (key === "position" || key === "loc" || key === "range") return undefined;
    return value;
  });
  return byteHash(serialized);
}

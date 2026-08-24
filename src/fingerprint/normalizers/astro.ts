/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Astro file normalizer using @astrojs/compiler AST — semantic hash invariant to formatting and comment changes.</purpose>
<non-goals>
  <item>Do not hash raw bytes — that is the binary normalizer's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Replaced regex-based normalization with @astrojs/compiler AST parsing for true semantic stability.</item>
</CHANGE_SUMMARY>
*/

import { parse as parseAstro } from "@astrojs/compiler";
import type { Node } from "@astrojs/compiler/types";
import { byteHash } from "../primitives.ts";

interface NormalizedAttribute {
  name: string;
  value: string;
  kind: string;
}

interface NormalizedAstroNode {
  type: string;
  name?: string;
  value?: string;
  attributes?: NormalizedAttribute[];
  children?: NormalizedAstroNode[];
}

function normalizeNode(node: Node): NormalizedAstroNode {
  if (node.type === "frontmatter") {
    return { type: "frontmatter", value: node.value.trim() };
  }

  if (
    node.type === "element" ||
    node.type === "component" ||
    node.type === "custom-element" ||
    node.type === "fragment"
  ) {
    return {
      type: node.type,
      name: node.name,
      attributes: (node.attributes ?? []).map((attr) => ({
        name: attr.name,
        value: attr.value?.trim() ?? "",
        kind: attr.kind,
      })),
      children: (node.children ?? []).map(normalizeNode),
    };
  }

  if (node.type === "text") {
    return { type: "text", value: (node.value ?? "").trim() };
  }

  if (node.type === "expression") {
    return { type: "expression", children: (node.children ?? []).map(normalizeNode) };
  }

  if (node.type === "root") {
    return { type: "root", children: (node.children ?? []).map(normalizeNode) };
  }

  return { type: node.type };
}

export async function normalizeAstro(content: string): Promise<string> {
  const result = await parseAstro(content, { position: false });
  const normalized = normalizeNode(result.ast);
  return byteHash(JSON.stringify(normalized));
}

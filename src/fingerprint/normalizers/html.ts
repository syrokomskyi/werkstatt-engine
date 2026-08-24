/*
<MODULE_CONTRACT>
<purpose>RFC-0379: HTML hasher — strips dynamic attributes, normalizes whitespace, and returns a sha256 hash for semantic comparison of HTML responses.</purpose>
<non-goals>
  <item>Do not validate HTML structure — this is a normalizer, not a validator.</item>
  <item>Do not parse embedded scripts or styles beyond stripping their content.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0379: initial HTML normalizer for health verification probe comparison.</item>
</CHANGE_SUMMARY>
*/

import { byteHash } from "../primitives.ts";

const DYNAMIC_ATTR_PREFIXES = ["data-", "nonce", "integrity", "crossorigin"] as const;

const PRESERVED_DATA_ATTRS = ["data-testid"] as const;

function isDynamicAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  if (PRESERVED_DATA_ATTRS.includes(lower as (typeof PRESERVED_DATA_ATTRS)[number])) {
    return false;
  }
  return DYNAMIC_ATTR_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

function stripStyles(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "");
}

function normalizeAttributes(tagMatch: string): string {
  return tagMatch.replace(
    /(\s+)([a-zA-Z-]+)(\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s>]+)?/g,
    (_full, whitespace: string, name: string, _value: string | undefined) => {
      if (isDynamicAttribute(name)) return "";
      return `${whitespace}${name}`;
    },
  );
}

function normalizeWhitespace(html: string): string {
  return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

export function hashHtml(content: string): string {
  const noComments = stripComments(content);
  const noScripts = stripScripts(noComments);
  const noStyles = stripStyles(noScripts);
  const normalizedAttrs = normalizeAttributes(noStyles);
  const collapsed = normalizeWhitespace(normalizedAttrs);
  return byteHash(collapsed);
}

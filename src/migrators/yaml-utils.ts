/*
<MODULE_CONTRACT>
<purpose>Shared YAML frontmatter parsing and serialization helpers for migrators.
Extracted from rfc-0481.ts for reuse by rfc-0483.ts and future migrators.</purpose>
<non-goals>
  <item>Does not implement migrator logic — helpers only.</item>
  <item>Does not depend on external YAML libraries — minimal hand-rolled parser sufficient for frontmatter.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0483: extracted YAML helpers from rfc-0481.ts into shared module.</item>
</CHANGE_SUMMARY>
*/

export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const yamlText = match[1];
  const body = match[2];
  const frontmatter = parseSimpleYaml(yamlText);
  return { frontmatter, body };
}

export function getIndent(line: string): number {
  let indent = 0;
  while (line[indent] === " ") indent++;
  return indent;
}

export function parseSimpleYaml(yamlText: string): Record<string, unknown> {
  const lines = yamlText.split("\n");
  const { result } = parseYamlBlock(lines, 0, 0);
  return result;
}

export function parseYamlBlock(
  lines: string[],
  startIdx: number,
  minIndent: number,
): { result: Record<string, unknown>; nextIdx: number } {
  const result: Record<string, unknown> = {};
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent < minIndent) break;
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const valuePart = trimmed.slice(colonIdx + 1).trim();
    if (valuePart === "") {
      const childIndent = indent + 2;
      const { result: nested, nextIdx } = parseYamlBlock(lines, i + 1, childIndent);
      result[key] = nested;
      i = nextIdx;
    } else if (valuePart === ">-" || valuePart === ">") {
      i++;
      const foldedLines: string[] = [];
      while (i < lines.length) {
        const foldedLine = lines[i];
        if (!foldedLine || getIndent(foldedLine) === 0) break;
        foldedLines.push(foldedLine.trim());
        i++;
      }
      result[key] = foldedLines.join(" ");
    } else if (valuePart.startsWith("- ")) {
      const items: string[] = [stripQuotes(valuePart.slice(2))];
      i++;
      while (i < lines.length) {
        const itemLine = lines[i];
        if (!itemLine || getIndent(itemLine) !== indent) break;
        const itemTrimmed = itemLine.trim();
        if (!itemTrimmed.startsWith("- ")) break;
        items.push(stripQuotes(itemTrimmed.slice(2)));
        i++;
      }
      result[key] = items;
    } else {
      result[key] = stripQuotes(valuePart);
      i++;
    }
  }
  return { result, nextIdx: i };
}

export function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      lines.push(`${key}: ${yamlValue(value)}`);
    } else if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${key}:`);
      serializeObject(value as Record<string, unknown>, lines, 2);
    }
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export function serializeObject(
  obj: Record<string, unknown>,
  lines: string[],
  indent: number,
): void {
  const prefix = " ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      lines.push(`${prefix}${key}: ${yamlValue(value)}`);
    } else if (typeof value === "number") {
      lines.push(`${prefix}${key}: ${value}`);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      serializeObject(value as Record<string, unknown>, lines, indent + 2);
    }
  }
}

export function needsQuoting(value: string): boolean {
  if (value === "") return true;
  return (
    /[:#\[\]{}&*!|>'"%`,\-?\n]/.test(value) ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value.startsWith("@")
  );
}

export function yamlValue(value: string): string {
  if (needsQuoting(value)) {
    return `"${escapeYamlString(value)}"`;
  }
  return value;
}

export function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

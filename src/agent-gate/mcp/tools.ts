/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: mechanical projection of the Agent Surface Manifest + active
capability records into the MCP `tools/list` result. One tool per knowledge
domain (read-only) and one per active action.
</purpose>
<non-goals>
  <item>Do not call tools here — that is mcp/handler.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial tools projection.</item>
  <item>RFC-1112: mark sideEffect "none" tools as side-effect-free previews.</item>
  <item>RFC-1115: render agentGuidance into multi-sentence tool descriptions via renderAgentGuidanceDescription.</item>
</CHANGE_SUMMARY>
*/

import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import { renderAgentGuidanceDescription } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

const EMPTY_INPUT_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

/** Pure: derive the tool list from the manifest's refs + the matching catalog records. */
export function buildToolsList(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): McpTool[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const tools: McpTool[] = [];

  for (const ref of manifest.knowledge) {
    tools.push({
      name: `knowledge.${ref.domain}.get`,
      description: `Read the ${ref.domain} knowledge file (${ref.schema}).`,
      inputSchema: EMPTY_INPUT_SCHEMA,
    });
  }
  for (const ref of manifest.actions) {
    const record = byId.get(ref.id);
    if (!record) continue;
    const base = record.description[manifest.languages.default] ?? ref.id;
    // RFC-1115: agentGuidance composes a model-oriented multi-sentence
    // description; absent guidance keeps the RFC-1112 fallback.
    const description = record.agentGuidance
      ? renderAgentGuidanceDescription(base, record.agentGuidance)
      : record.sideEffect === "none"
        ? `${base} (Side-effect-free preview — validates input and returns a draftId; dispatches nothing.)`
        : base;
    tools.push({
      name: `action.${ref.id}`,
      description,
      inputSchema: record.input,
    });
  }
  return tools;
}

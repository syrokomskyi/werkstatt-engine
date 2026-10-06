/*
<MODULE_CONTRACT>
<purpose>
RFC-1211: MCP-UI resource projection for the stateless MCP subset. ui://
resource descriptors derive from the active capability catalog (records
declaring ui.resource === true) — suppressed/disabled capabilities are absent
from the serialized catalog upstream, so the emitted set always mirrors the
manifest. resources/read resolves a ui:// URI to the committed
/.well-known/ui/<capability>.html artifact via the knowledge port.
</purpose>
<non-goals>
  <item>Do not render UI here — artifacts are committed generated files
        emitted by agent.ui.generate; the gate only serves them.</item>
  <item>Do not add ui/notifications/* or interactive bridges — v1 resources
        are read-only text/html.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1211: initial implementation — ui:// list/read helpers + tool-result resource block.</item>
</CHANGE_SUMMARY>
*/

import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import {
  parseUiResourceUri,
  UI_RESOURCE_MIME,
  uiResourcePath,
  uiResourceUri,
} from "@warpgogol/werkstatt-shared/agent/capability-schema";

export interface McpUiResourceDescriptor {
  uri: string;
  name: string;
  mimeType: string;
  title: string;
}

/** RFC-1211: capabilities carrying a ui:// projection in the given catalog. */
export function uiCapableCapabilities(catalog: readonly CapabilityRecord[]): CapabilityRecord[] {
  return catalog
    .filter((cap) => cap.ui?.resource === true)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** resources/list entries for the ui:// emission set. */
export function buildUiResourceList(
  site: string,
  catalog: readonly CapabilityRecord[],
): McpUiResourceDescriptor[] {
  return uiCapableCapabilities(catalog).map((cap) => ({
    uri: uiResourceUri(site, cap.id),
    name: cap.id,
    mimeType: UI_RESOURCE_MIME,
    title: Object.values(cap.title)[0] ?? cap.id,
  }));
}

/**
 * Resolve a ui:// URI to its committed public path when it belongs to this
 * site AND names a ui-capable catalog record. Returns null for foreign-site
 * or non-ui URIs — the caller answers INVALID_PARAMS (unknown resource).
 */
export function resolveUiResourcePath(
  uri: string,
  site: string,
  catalog: readonly CapabilityRecord[],
): string | null {
  const parsed = parseUiResourceUri(uri);
  if (!parsed || parsed.site !== site) return null;
  const cap = catalog.find((c) => c.id === parsed.capabilityId);
  if (!cap || cap.ui?.resource !== true) return null;
  return uiResourcePath(parsed.capabilityId);
}

/**
 * RFC-1211: the {type:"resource"} content block appended to tool results of
 * ui-capable capabilities. `text` carries the committed artifact bytes when
 * the knowledge port could read them — otherwise the block degrades to the
 * uri+mimeType reference and hosts fetch via resources/read.
 */
export function uiResourceContentBlock(
  site: string,
  capabilityId: string,
  text: string | null,
): { type: "resource"; resource: { uri: string; mimeType: string; text?: string } } {
  return {
    type: "resource",
    resource: {
      uri: uiResourceUri(site, capabilityId),
      mimeType: UI_RESOURCE_MIME,
      ...(text !== null ? { text } : {}),
    },
  };
}

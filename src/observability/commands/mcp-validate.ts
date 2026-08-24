/*
<MODULE_CONTRACT>
<purpose>observability.mcp.validate — offline lint for the SigNoz MCP server entry (RFC-0344).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0344: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  CheckResult,
  Diagnostic,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks";

const SIGNOZ_KEY_PATTERN = /[a-f0-9]{32,}/gi;

export async function runObservabilityMcpValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];
  const root = context.workspaceRoot;
  const mcpPath = join(root, ".mcp.json");

  // OBS-MCP-01: .mcp.json must have signoz entry with env-referenced token
  if (!(await context.io.exists(mcpPath))) {
    diagnostics.push({
      ruleId: "OBS-MCP-01",
      severity: "error",
      file: ".mcp.json",
      message: ".mcp.json does not exist — the signoz MCP server entry is required (RFC-0344).",
      fixHint: "Create .mcp.json with a signoz server entry using ${WARPGOGOL_SIGNOZ_MCP_TOKEN}.",
    });
  } else {
    const raw = await context.io.readFile(mcpPath);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const servers = (parsed as { mcpServers?: Record<string, unknown> }).mcpServers;
      if (!servers || !servers["signoz"]) {
        diagnostics.push({
          ruleId: "OBS-MCP-01",
          severity: "error",
          file: ".mcp.json",
          message: ".mcp.json lacks the 'signoz' MCP server entry.",
          fixHint: 'Add a "signoz" entry under "mcpServers" pointing at the SigNoz MCP endpoint.',
        });
      } else {
        const signozEntry = JSON.stringify(servers["signoz"]);
        if (!signozEntry.includes("${WARPGOGOL_SIGNOZ_MCP_TOKEN}")) {
          diagnostics.push({
            ruleId: "OBS-MCP-01",
            severity: "error",
            file: ".mcp.json",
            message:
              "signoz MCP entry embeds a literal token instead of the env reference ${WARPGOGOL_SIGNOZ_MCP_TOKEN}.",
            fixHint: "Replace any literal token with ${WARPGOGOL_SIGNOZ_MCP_TOKEN}.",
          });
        }
      }
    } catch {
      diagnostics.push({
        ruleId: "OBS-MCP-01",
        severity: "error",
        file: ".mcp.json",
        message: ".mcp.json is not valid JSON.",
        fixHint: "Fix the JSON syntax in .mcp.json.",
      });
    }
  }

  // OBS-MCP-02: scan for SigNoz API key patterns in .mcp.json and nearby config files
  const scanFiles = [".mcp.json", "services/observability-stack/.env.example"];
  for (const relPath of scanFiles) {
    const absPath = join(root, relPath);
    if (!(await context.io.exists(absPath))) continue;
    const text = await context.io.readFile(absPath);
    const matches = text.match(SIGNOZ_KEY_PATTERN);
    if (matches) {
      for (const match of matches) {
        // Skip env var references and placeholder patterns
        if (match.includes("$") || match.toLowerCase().includes("replace")) continue;
        diagnostics.push({
          ruleId: "OBS-MCP-02",
          severity: "error",
          file: relPath,
          message: `Potential SigNoz API key found in committed file: ${match.slice(0, 8)}...`,
          fixHint: "Remove the secret and use an env var reference instead.",
        });
      }
    }
  }

  // OBS-MCP-03: incidents README must exist
  const incidentsPath = join(root, "docs", "observability", "incidents", "README.md");
  if (!(await context.io.exists(incidentsPath))) {
    diagnostics.push({
      ruleId: "OBS-MCP-03",
      severity: "warning",
      file: "docs/observability/incidents/README.md",
      message: "Incident note template is missing.",
      fixHint: "Create docs/observability/incidents/README.md with the incident note template.",
    });
  }

  return diagnosticsResult("observability.mcp.validate", diagnostics);
}

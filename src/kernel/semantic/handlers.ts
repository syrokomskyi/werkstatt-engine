/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/semantic/handlers.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not generate semantic content — only validate existing outputs.</item>
  <item>Do not modify source files during validation.</n</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0042: Created semantic validation handlers for NEED_THIS_* marker detection.</item>
</CHANGE_SUMMARY>
*/

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";

interface NeedThisMarker {
  file: string;
  line: number;
  content: string;
  marker: string;
}

const NEED_THIS_REGEX = /NEED_THIS_[A-Z_]+/g;

/**
 * Scan a single file for NEED_THIS_* markers.
 */
async function scanFile(
  filePath: string,
  logger: KernelRuntimeContext["logger"],
): Promise<NeedThisMarker[]> {
  const markers: NeedThisMarker[] = [];
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.match(NEED_THIS_REGEX);
      if (matches) {
        for (const marker of matches) {
          markers.push({
            file: filePath,
            line: i + 1,
            content: line.trim(),
            marker,
          });
        }
      }
    }
  } catch (error) {
    logger.warn(`Failed to read file ${filePath}: ${error}`);
  }
  return markers;
}

/**
 * Recursively scan directory for files with NEED_THIS_* markers.
 */
async function scanDirectory(
  dirPath: string,
  extensions: string[] = [".md", ".txt", ".astro", ".ts", ".js"],
  logger: KernelRuntimeContext["logger"],
): Promise<NeedThisMarker[]> {
  const markers: NeedThisMarker[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }
        const nested = await scanDirectory(fullPath, extensions, logger);
        markers.push(...nested);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (extensions.includes(ext)) {
          const fileMarkers = await scanFile(fullPath, logger);
          markers.push(...fileMarkers);
        }
      }
    }
  } catch (error) {
    logger.warn(`Failed to scan directory ${dirPath}: ${error}`);
  }

  return markers;
}

/**
 * [RFC-0042] Validate that pages do not contain NEED_THIS_* markers.
 * This command scans the semantic output directory and fails if explicit
 * missing field markers are present.
 *
 * Options:
 *   --path <dir>     Custom path to scan (default: dist/llms)
 *   --strict         Fail on markers even in development (default: false)
 *   --json           Output results as JSON
 */
export async function runSemanticPageValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const logger = context.logger;
  const flags = input.flags ?? {};
  const strict = flags.strict === true || flags.strict === "true";
  const jsonOutput = flags.json === true || flags.json === "true";
  const baseDir = context.site?.directory ?? context.workspaceRoot;
  const scanPath = flags.path ? resolve(flags.path as string) : resolve(baseDir, "dist", "llms");

  logger.info(`[RFC-0042] Scanning for NEED_THIS_* markers in: ${scanPath}`);

  // Scan the directory
  const markers = await scanDirectory(scanPath, undefined, logger);

  if (markers.length === 0) {
    const message = "[RFC-0042] ✓ No NEED_THIS_* markers found. All content is explicit.";
    logger.info(message);
    return {
      data: jsonOutput ? { markers: [], count: 0 } : undefined,
      summary: `[semantic.page.validate] ${message}`,
      exitCode: 0,
    };
  }

  // Log findings
  logger.error(`[RFC-0042] ✗ Found ${markers.length} NEED_THIS_* marker(s):`);
  for (const marker of markers) {
    logger.error(`  ${marker.file}:${marker.line} → ${marker.marker}`);
    logger.error(`    ${marker.content.substring(0, 80)}...`);
  }

  // Determine if we should fail
  const isProduction = process.env.NODE_ENV === "production" || flags.prod === true;
  const shouldFail = isProduction || strict;

  const message =
    `[RFC-0042] Found ${markers.length} explicit missing field marker(s). ` +
    `Content requires attention.`;

  if (jsonOutput) {
    return {
      data: {
        markers,
        count: markers.length,
        shouldFail,
        isProduction,
      },
      summary: `[semantic.page.validate] ${message}`,
      exitCode: shouldFail ? 1 : 0,
      nextSteps: shouldFail
        ? [
            {
              action:
                "Fix the NEED_THIS_* markers listed above, then re-run semantic.page.validate",
              kind: "required",
            },
          ]
        : undefined,
    };
  }

  return {
    summary: `[semantic.page.validate] ${message}`,
    exitCode: shouldFail ? 1 : 0,
    nextSteps: shouldFail
      ? [
          {
            action: "Fix the NEED_THIS_* markers listed above, then re-run semantic.page.validate",
            kind: "required",
          },
        ]
      : undefined,
  };
}

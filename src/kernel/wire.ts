/*
<MODULE_CONTRACT>
<purpose>Generates the app-local tools/kernel.config.ts wiring file — a thin delegation to the canonical site module map (RFC-1147/RFC-1148).</purpose>
<non-goals>
  <item>Do not generate app src/ or public/ boilerplate.</item>
  <item>Do not discover behavior from arbitrary app code.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Wiring is generated from system.md — never hand-edited.</item>
  <item>The module surface is uniform: kernel.config.ts delegates to siteModuleLoaders() (SITE_MODULE_MAP), so every site loads the same 18 modules unconditionally.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1147: uniform surface — wire emits only tools/kernel.config.ts delegating to siteModuleLoaders(); module templates, runtime re-export shims, and conditional module decisions deleted.</item>
</CHANGE_SUMMARY>
*/

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";
import { discoverSiteWorkspaces } from "./discovery.ts";
import { loadSystemManifestSync } from "@warpgogol/werkstatt-shared/content";
import { buildGeneratedHeader, hasGeneratedMarker } from "./generated-marker.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates", "wire");

type WireWarning = {
  file: string;
  message: string;
};

type KernelWireResult = {
  command: "kernel.wire";
  status: "ok" | "fail";
  generated: string[];
  warnings?: WireWarning[];
};

// RFC-0336: repo-relative root for wire template files, used to build the
// "Edit instead:" line of the advisory header — never hand-roll the marker here.
const WIRE_TEMPLATES_REPO_RELATIVE = "packages/werkstatt/src/kernel/templates/wire";

function wireContent(templateRelPath: string, siteName: string, content: string): string {
  const header = buildGeneratedHeader({
    filePath: "tools/kernel-wire-output.ts",
    ownerCommand: "kernel.wire",
    templatePath: `${WIRE_TEMPLATES_REPO_RELATIVE}/${templateRelPath}`,
    site: siteName,
  });
  return `${header}${content}`;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function writeGeneratedFile(
  absolutePath: string,
  content: string,
  appDir: string,
  dryRun: boolean,
  warnings: WireWarning[],
): Promise<boolean> {
  const existing = await readFileIfExists(absolutePath);
  if (existing === content) {
    return false;
  }
  if (existing !== null && !hasGeneratedMarker(existing)) {
    warnings.push({
      file: absolutePath,
      message: `"${rel(appDir, absolutePath)}" is project-specific (no GENERATED marker) — skipped.`,
    });
    return false;
  }
  if (!dryRun) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
  return true;
}

function rel(appDirectory: string, absolutePath: string): string {
  return path.relative(appDirectory, absolutePath).replace(/\\/g, "/");
}

function readTemplate(templatePath: string): string {
  return readFileSync(path.join(TEMPLATES_DIR, templatePath), "utf8");
}

function applyTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key) => tokens[key] ?? "");
}

function buildKernelConfigFile(appName: string): string {
  return wireContent(
    "tools/kernel.config.template.ts",
    appName,
    applyTokens(readTemplate("tools/kernel.config.template.ts"), {
      APP_NAME: appName,
    }),
  );
}

async function resolveWirePaths(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<{
  appDirectory: string;
  srcDirectory: string;
  publicDirectory: string;
  contentDirectory: string;
  contentPagesDirectory: string;
  stylesDirectory: string;
}> {
  if (context.site) {
    const appDirectory = context.site.directory;
    const srcDirectory = path.join(appDirectory, "src");
    return {
      appDirectory,
      srcDirectory,
      publicDirectory: path.join(appDirectory, "public"),
      contentDirectory: path.join(srcDirectory, "content"),
      contentPagesDirectory: path.join(srcDirectory, "content", "pages"),
      stylesDirectory: path.join(srcDirectory, "styles"),
    };
  }

  const requestedSite =
    typeof input.flags.site === "string"
      ? input.flags.site
      : Array.isArray(input.flags.site)
        ? input.flags.site[0]
        : undefined;
  const sites = await discoverSiteWorkspaces(context.workspaceRoot);
  const target = requestedSite
    ? sites.find((site) => site.name === requestedSite)
    : sites.length === 1
      ? sites[0]
      : undefined;

  if (!target) {
    throw new Error(
      "kernel.wire requires --site <name> when no app-scoped runtime context is available.",
    );
  }

  const srcDirectory = path.join(target.directory, "src");
  return {
    appDirectory: target.directory,
    srcDirectory,
    publicDirectory: path.join(target.directory, "public"),
    contentDirectory: path.join(srcDirectory, "content"),
    contentPagesDirectory: path.join(srcDirectory, "content", "pages"),
    stylesDirectory: path.join(srcDirectory, "styles"),
  };
}

export async function runKernelWire(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<KernelWireResult>> {
  const paths = await resolveWirePaths(_input, context);
  const { manifest } = loadSystemManifestSync(paths.contentDirectory);
  const warnings: WireWarning[] = [];
  const generated: string[] = [];

  // RFC-1147: the only emitted file — kernel.config.ts delegates to
  // siteModuleLoaders() (SITE_MODULE_MAP), so every site gets the same
  // 18-module surface unconditionally. tools/modules/ and tools/runtime/
  // are no longer generated.
  const files: Array<{ absolutePath: string; content: string }> = [
    {
      absolutePath: path.join(paths.appDirectory, "tools", "kernel.config.ts"),
      content: buildKernelConfigFile(manifest.app),
    },
  ];

  for (const file of files) {
    const changed = await writeGeneratedFile(
      file.absolutePath,
      file.content,
      paths.appDirectory,
      context.dryRun ?? false,
      warnings,
    );
    if (changed) {
      generated.push(rel(paths.appDirectory, file.absolutePath));
    }
  }

  return {
    data: {
      command: "kernel.wire",
      status: "ok",
      generated,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    exitCode: 0,
    summary: `[kernel.wire] ${generated.length} file(s) ${context.dryRun ? "would be written" : "written"}`,
  };
}

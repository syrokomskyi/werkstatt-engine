/*
<MODULE_CONTRACT>
<purpose>Generates app-local tools/ kernel wiring from system.md and installed package capabilities.</purpose>
<non-goals>
  <item>Do not generate app src/ or public/ boilerplate.</item>
  <item>Do not discover behavior from arbitrary app code.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Implements RFC-0078 Tier 3 kernel.wire command.</item>
</CHANGE_SUMMARY>
*/

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "./types.ts";
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
  modulesDetected: string[];
  modulesSkipped: string[];
  warnings?: WireWarning[];
};

type AppPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type ModuleDecision = {
  key: string;
  include: boolean;
  reason?: string;
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

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

function hasPackage(pkg: AppPackageJson | null, name: string): boolean {
  if (pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]) return true;
  // Consolidated packages (RFC-0776): @warpgogol/werkstatt-engine covers all /changelog,
  // /integrity, /handoff subpaths; @warpgogol/werkstatt-site covers /onboarding,
  // /checks, /codegen, /deploy, etc.
  const parent = name.split("/").slice(0, 2).join("/");
  if (parent !== name) {
    return Boolean(pkg?.dependencies?.[parent] ?? pkg?.devDependencies?.[parent]);
  }
  return false;
}

function buildModuleDecisions(
  packageJson: AppPackageJson | null,
  passportEnabled: boolean,
): ModuleDecision[] {
  return [
    { key: "check", include: true },
    { key: "service", include: true },
    { key: "deploy", include: true },
    {
      key: "integrity",
      include: passportEnabled || hasPackage(packageJson, "@warpgogol/werkstatt-engine/integrity"),
      reason: passportEnabled
        ? undefined
        : "passport disabled and integrity package not required by manifest",
    },
    {
      key: "changelog",
      include: hasPackage(packageJson, "@warpgogol/werkstatt-engine/changelog"),
      reason: "changelog package not installed",
    },
    {
      key: "onboarding",
      include: hasPackage(packageJson, "@warpgogol/werkstatt-shared/onboarding"),
      reason: "onboarding package not installed",
    },
    {
      key: "rfc",
      include: true,
    },
  ];
}

function readTemplate(templatePath: string): string {
  return readFileSync(path.join(TEMPLATES_DIR, templatePath), "utf8");
}

function applyTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key) => tokens[key] ?? "");
}

function buildKernelConfigFile(appName: string, _includedModules: string[]): string {
  return wireContent(
    "tools/kernel.config.template.ts",
    appName,
    applyTokens(readTemplate("tools/kernel.config.template.ts"), {
      APP_NAME: appName,
    }),
  );
}

function buildCheckModuleFile(appName: string): string {
  return wireContent(
    "tools/modules/check.module.template.ts",
    appName,
    applyTokens(readTemplate("tools/modules/check.module.template.ts"), {}),
  );
}

function buildServiceModuleFile(appName: string): string {
  return wireContent(
    "tools/modules/service.module.template.ts",
    appName,
    applyTokens(readTemplate("tools/modules/service.module.template.ts"), {}),
  );
}

function buildDeployModuleFile(appName: string): string {
  return wireContent(
    "tools/modules/deploy.module.template.ts",
    appName,
    applyTokens(readTemplate("tools/modules/deploy.module.template.ts"), {}),
  );
}

function buildIntegrityModuleFile(appName: string): string {
  return wireContent(
    "tools/modules/integrity.module.template.ts",
    appName,
    applyTokens(readTemplate("tools/modules/integrity.module.template.ts"), {}),
  );
}

function buildChangelogModuleFile(appName: string): string {
  return wireContent(
    "tools/modules/changelog.module.template.ts",
    appName,
    applyTokens(readTemplate("tools/modules/changelog.module.template.ts"), {}),
  );
}

function buildRuntimeReExport(appName: string, packageName: string, exportsList: string[]): string {
  return wireContent(
    "tools/runtime/re-export.template.ts",
    appName,
    applyTokens(readTemplate("tools/runtime/re-export.template.ts"), {
      PACKAGE_NAME: packageName,
      EXPORTS_LIST: exportsList.join(",\n  "),
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
  const packageJson = await readJson<AppPackageJson>(path.join(paths.appDirectory, "package.json"));
  const passportEnabled = Boolean(manifest.release?.passport?.enabled);
  const decisions = buildModuleDecisions(packageJson, passportEnabled);
  const included = decisions.filter((item) => item.include).map((item) => item.key);
  const skipped = decisions.filter((item) => !item.include).map((item) => item.key);
  const warnings: WireWarning[] = [];
  const generated: string[] = [];

  const files: Array<{ absolutePath: string; content: string }> = [
    {
      absolutePath: path.join(paths.appDirectory, "tools", "kernel.config.ts"),
      content: buildKernelConfigFile(manifest.app, included),
    },
    {
      absolutePath: path.join(paths.appDirectory, "tools", "modules", "check.module.ts"),
      content: buildCheckModuleFile(manifest.app),
    },
    {
      absolutePath: path.join(paths.appDirectory, "tools", "modules", "service.module.ts"),
      content: buildServiceModuleFile(manifest.app),
    },
    {
      absolutePath: path.join(paths.appDirectory, "tools", "modules", "deploy.module.ts"),
      content: buildDeployModuleFile(manifest.app),
    },
    {
      absolutePath: path.join(paths.appDirectory, "tools", "runtime", "app.ts"),
      content: wireContent(
        "tools/runtime/app.template.ts",
        manifest.app,
        readTemplate("tools/runtime/app.template.ts"),
      ),
    },
    {
      absolutePath: path.join(paths.appDirectory, "tools", "runtime", "check.ts"),
      content: wireContent(
        "tools/runtime/check.template.ts",
        manifest.app,
        readTemplate("tools/runtime/check.template.ts"),
      ),
    },
    {
      absolutePath: path.join(paths.appDirectory, "tools", "runtime", "service.ts"),
      content: buildRuntimeReExport(manifest.app, "@warpgogol/werkstatt-site/codegen", [
        "runGenerateIcons",
        "runCleanIcons",
        "runGenerateOpenSourcePage",
      ]),
    },
    {
      absolutePath: path.join(paths.appDirectory, "tools", "runtime", "client-export.ts"),
      content: buildRuntimeReExport(manifest.app, "@warpgogol/werkstatt-site/deploy", [
        "runClientExport",
      ]),
    },
  ];

  if (included.includes("integrity")) {
    files.push({
      absolutePath: path.join(paths.appDirectory, "tools", "modules", "integrity.module.ts"),
      content: buildIntegrityModuleFile(manifest.app),
    });
    files.push({
      absolutePath: path.join(paths.appDirectory, "tools", "runtime", "integrity.ts"),
      content: buildRuntimeReExport(manifest.app, "@warpgogol/werkstatt-engine/integrity", [
        "runIntegrityInit",
        "runIntegrityUpdate",
        "runIntegrityVerify",
        "runIntegrityBuildRecord",
        "runIntegritySign",
        "runIntegrityVerifyRelease",
        "runIntegrityGenerateSigningKeypair",
        "runIntegrityBackfillRevisions",
      ]),
    });
  }

  if (included.includes("changelog")) {
    files.push({
      absolutePath: path.join(paths.appDirectory, "tools", "modules", "changelog.module.ts"),
      content: buildChangelogModuleFile(manifest.app),
    });
    files.push({
      absolutePath: path.join(paths.appDirectory, "tools", "runtime", "changelog.ts"),
      content: buildRuntimeReExport(manifest.app, "@warpgogol/werkstatt-engine/changelog", [
        "runChangelogGenerate",
        "runChangelogRebuildIndex",
        "runChangelogBackfill",
      ]),
    });
  }

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
      modulesDetected: included,
      modulesSkipped: skipped,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    exitCode: 0,
    summary: `[kernel.wire] ${generated.length} file(s) ${context.dryRun ? "would be written" : "written"}`,
  };
}

/*
<MODULE_CONTRACT>
<purpose>icons index — generation of Astro components from icon JSON files for dynamic icon loading.</purpose>
<non-goals>
  <item>Do not handle raw asset parsing or validation beyond filename structure.</item>
  <item>Do not manage transport or configuration orchestration for the icon sets.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Icon components are generated from JSON — the JSON is the source of truth, not the .astro output.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1254: drop unused io-migration leftovers</item>
</CHANGE_SUMMARY>
*/

/**
 * Icons generation module for site-kernel
 * Generates Astro components from LordIcon JSON files
 *
 * @module
 */

import path from "path";
import { fileURLToPath } from "url";
import { type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelLogger,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates", "icons");

// Configuration — icon assets and generated components live in the
// werkstatt-site domain/ui package (RFC-0776 consolidation; RFC-1147 path fix).
const UI_PACKAGE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "werkstatt-site",
  "src",
  "domain",
  "ui",
);
const ASSETS_BASE = path.join(UI_PACKAGE_PATH, "assets", "icons");
const OUTPUT_BASE = path.join(UI_PACKAGE_PATH, "icons", "gen");

type IconSet = { base: string; set: string };

/**
 * Discover all icon sets dynamically from filesystem
 * Structure: ASSETS_BASE/{base}/{set}/icon.json
 * Examples: lordicon/doodle-outline/, heroicons/24-outline/
 */
async function discoverIconSets(logger: KernelLogger, io: WorkspaceIO): Promise<IconSet[]> {
  if (!(await io.exists(ASSETS_BASE))) {
    logger.event({
      severity: "notice",
      kind: "expected-fallback",
      message: `Assets base directory not found: ${ASSETS_BASE}`,
      module: "icons",
      dedupeKey: `icons-assets-base-missing:${ASSETS_BASE}`,
      data: { assetsBase: ASSETS_BASE },
    });
    return [];
  }

  const iconSets: IconSet[] = [];

  // Find base sets (top-level directories)
  const baseEntries = await io.readdir(ASSETS_BASE);
  const baseSets = baseEntries.filter((entry) => entry.isDirectory).map((entry) => entry.name);

  for (const base of baseSets) {
    const basePath = path.join(ASSETS_BASE, base);
    const setEntries = await io.readdir(basePath);
    const sets = setEntries.filter((entry) => entry.isDirectory).map((entry) => entry.name);

    for (const set of sets) {
      iconSets.push({ base, set });
    }
  }

  logger.info(`Discovered ${iconSets.length} icon set(s) in ${baseSets.length} base(s)`);
  for (const { base, set } of iconSets) {
    logger.info(`  - ${base}/${set}`);
  }

  return iconSets;
}

/**
 * Convert icon name to valid JS identifier (PascalCase for component)
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Convert icon name to camelCase for variable export
 */
function _toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Parse icon filename to extract metadata
 * Format: {set}-{id}-{name}-{trigger}.json
 */
function parseIconFilename(filename: string, set: string): { name: string; id: string } | null {
  const match = filename.match(new RegExp(`^${set}-(\\d+)-(.+)-(.+)\\.json$`));
  if (!match) return null;

  const [, id, rawName] = match;
  return { name: rawName, id };
}

async function readTemplate(templatePath: string, io: WorkspaceIO): Promise<string> {
  return io.readFile(path.join(TEMPLATES_DIR, templatePath));
}

function applyTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key) => tokens[key] ?? "");
}

/**
 * Generate Astro component content for an icon from template.
 */
async function generateIconComponent(
  _iconName: string,
  _set: string,
  relativeJsonPath: string,
  io: WorkspaceIO,
): Promise<string> {
  return applyTokens(await readTemplate("lord-icon-component.template.astro", io), {
    RELATIVE_JSON_PATH: relativeJsonPath,
  });
}

/**
 * Generate index.ts content for an icon set from template.
 */
async function generateIndexExports(
  exports: Array<{ fileName: string; exportName: string; subfolder: string }>,
  io: WorkspaceIO,
): Promise<string> {
  const exportsList = exports
    .map(({ fileName, exportName, subfolder }) => {
      return `export { default as ${exportName} } from "./${subfolder}/${fileName}";`;
    })
    .join("\n");
  return applyTokens(await readTemplate("index.template.ts", io), {
    EXPORTS_LIST: exportsList,
  });
}

/**
 * Process a single icon set
 */
async function processIconSet(
  iconSet: IconSet,
  logger: KernelLogger,
  io: WorkspaceIO,
): Promise<{ generated: number; errors: number }> {
  const { base, set } = iconSet;
  const inputDir = path.join(ASSETS_BASE, base, set);
  const outputDir = path.join(OUTPUT_BASE, base, set);

  if (!(await io.exists(inputDir))) {
    logger.warn(`Input directory not found: ${inputDir}`);
    return { generated: 0, errors: 0 };
  }

  // Ensure output directory exists
  await io.mkdir(outputDir);

  const jsonFiles = (await io.readdir(inputDir))
    .map((e) => e.name)
    .filter((f) => f.endsWith(".json"));
  const exports: Array<{ fileName: string; exportName: string; subfolder: string }> = [];

  let generated = 0;
  let errors = 0;

  for (const jsonFile of jsonFiles) {
    const parsed = parseIconFilename(jsonFile, set);
    if (!parsed) {
      logger.warn(`Skipping malformed filename: ${jsonFile}`);
      errors++;
      continue;
    }

    const { name, id: _id } = parsed;
    const baseName = toPascalCase(name) + "Icon";
    const componentName = /^\d/.test(baseName) ? `Icon${baseName}` : baseName;
    const componentFileName = `${name}-icon.astro`;

    // Subfolder based on first letter (a/, b/, c/, etc.)
    const subfolder = name.charAt(0).toLowerCase();
    const subfolderPath = path.join(outputDir, subfolder);

    await io.mkdir(subfolderPath);

    // Calculate relative path from component to JSON asset
    // From: domain/ui/icons/gen/{base}/{subfolder}/
    // To:   domain/ui/assets/icons/{base}/{set}/
    const relativeJsonPath = `../../../../assets/icons/${base}/${set}/${jsonFile}`;

    const componentContent = await generateIconComponent(name, set, relativeJsonPath, io);
    const componentPath = path.join(subfolderPath, componentFileName);

    await io.writeFile(componentPath, componentContent);

    exports.push({
      fileName: componentFileName,
      exportName: componentName,
      subfolder,
    });

    generated++;
  }

  // Sort exports alphabetically by subfolder then filename
  exports.sort((a, b) => {
    if (a.subfolder !== b.subfolder) return a.subfolder.localeCompare(b.subfolder);
    return a.fileName.localeCompare(b.fileName);
  });

  // Generate index.ts
  const indexContent = await generateIndexExports(exports, io);
  await io.writeFile(path.join(outputDir, "index.ts"), indexContent);

  logger.info(`Generated ${generated} components for ${set} (index.ts: ${exports.length} exports)`);

  return { generated, errors };
}

/**
 * Main command handler for ui.icons.generate
 */
export async function runIconsGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const logger = context.logger;
  const outputFormat = context.outputFormat;
  logger.info("Starting icons generation...");

  let totalGenerated = 0;
  let totalErrors = 0;

  // Discover icon sets dynamically
  const iconSets = await discoverIconSets(logger, context.io);

  if (iconSets.length === 0) {
    logger.warn("No icon sets found to process");
    return {
      exitCode: 0,
      summary: "[index] No icon sets found",
      data: {
        command: "ui.icons.generate",
        status: "success",
        generated: {
          components: 0,
          sets: 0,
        },
      },
    };
  }

  for (const set of iconSets) {
    const result = await processIconSet(set, logger, context.io);
    totalGenerated += result.generated;
    totalErrors += result.errors;
  }

  logger.info(
    `\n✅ Icons generation complete: ${totalGenerated} components, ${totalErrors} errors`,
  );

  const result = {
    exitCode: totalErrors > 0 ? 1 : 0,
    summary: `Generated ${totalGenerated} icon components${totalErrors > 0 ? ` (${totalErrors} errors)` : ""}`,
    data: {
      command: "ui.icons.generate",
      status: totalErrors > 0 ? "fail" : "success",
      generated: {
        components: totalGenerated,
        sets: iconSets.length,
      },
    },
  };

  // Output JSON if requested
  if (outputFormat === "json") {
    logger.info(JSON.stringify(result.data, null, 2));
  }

  return result;
}

/**
 * Icons module definition
 */
export const iconsModule = {
  name: "icons",
  description: "Generate Astro icon components from LordIcon JSON files",
  commands: {
    generate: {
      name: "generate",
      description: "Generate icon components for @warpgogol/werkstatt-site/ui package",
      run: runIconsGenerate,
    },
  },
};

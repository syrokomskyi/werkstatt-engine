/*
<MODULE_CONTRACT>
<purpose>Facilitates the generation of Astro components from icon JSON files, enabling dynamic icon set management.</purpose>
<non-goals>
  <item>Do not handle raw asset parsing or validation beyond filename structure.</item>
  <item>Do not manage transport or configuration orchestration for the icon sets.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

/**
 * Icons generation module for site-kernel
 * Generates Astro components from LordIcon JSON files
 *
 * @module
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelLogger,
  KernelRuntimeContext,
} from "../types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates", "icons");

// Configuration
const UI_PACKAGE_PATH = path.join(__dirname, "..", "..", "..", "..", "ui");
const ASSETS_BASE = path.join(UI_PACKAGE_PATH, "src", "assets", "icons");
const OUTPUT_BASE = path.join(UI_PACKAGE_PATH, "src", "icons", "gen");

type IconSet = { base: string; set: string };

/**
 * Discover all icon sets dynamically from filesystem
 * Structure: ASSETS_BASE/{base}/{set}/icon.json
 * Examples: lordicon/doodle-outline/, heroicons/24-outline/
 */
function discoverIconSets(logger: KernelLogger): IconSet[] {
  if (!fs.existsSync(ASSETS_BASE)) {
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
  const baseEntries = fs.readdirSync(ASSETS_BASE, { withFileTypes: true });
  const baseSets = baseEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  for (const base of baseSets) {
    const basePath = path.join(ASSETS_BASE, base);
    const setEntries = fs.readdirSync(basePath, { withFileTypes: true });
    const sets = setEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

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

function readTemplate(templatePath: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, templatePath), "utf8");
}

function applyTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key) => tokens[key] ?? "");
}

/**
 * Generate Astro component content for an icon from template.
 */
function generateIconComponent(_iconName: string, _set: string, relativeJsonPath: string): string {
  return applyTokens(readTemplate("lord-icon-component.template.astro"), {
    RELATIVE_JSON_PATH: relativeJsonPath,
  });
}

/**
 * Generate index.ts content for an icon set from template.
 */
function generateIndexExports(
  exports: Array<{ fileName: string; exportName: string; subfolder: string }>,
): string {
  const exportsList = exports
    .map(({ fileName, exportName, subfolder }) => {
      return `export { default as ${exportName} } from "./${subfolder}/${fileName}";`;
    })
    .join("\n");
  return applyTokens(readTemplate("index.template.ts"), {
    EXPORTS_LIST: exportsList,
  });
}

/**
 * Process a single icon set
 */
async function processIconSet(
  iconSet: IconSet,
  logger: KernelLogger,
): Promise<{ generated: number; errors: number }> {
  const { base, set } = iconSet;
  const inputDir = path.join(ASSETS_BASE, base, set);
  const outputDir = path.join(OUTPUT_BASE, base, set);

  if (!fs.existsSync(inputDir)) {
    logger.warn(`Input directory not found: ${inputDir}`);
    return { generated: 0, errors: 0 };
  }

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonFiles = fs.readdirSync(inputDir).filter((f) => f.endsWith(".json"));
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

    fs.mkdirSync(subfolderPath, { recursive: true });

    // Calculate relative path from component to JSON asset
    // From: packages/ui/src/icons/gen/{base}/{subfolder}/
    // To:   packages/ui/src/assets/icons/{base}/{set}/
    const relativeJsonPath = `../../../../../assets/icons/${base}/${set}/${jsonFile}`;

    const componentContent = generateIconComponent(name, set, relativeJsonPath);
    const componentPath = path.join(subfolderPath, componentFileName);

    fs.writeFileSync(componentPath, componentContent, "utf8");

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
  const indexContent = generateIndexExports(exports);
  fs.writeFileSync(path.join(outputDir, "index.ts"), indexContent, "utf8");

  logger.info(`Generated ${generated} components for ${set} (index.ts: ${exports.length} exports)`);

  return { generated, errors };
}

/**
 * Main command handler for icons.generate
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
  const iconSets = discoverIconSets(logger);

  if (iconSets.length === 0) {
    logger.warn("No icon sets found to process");
    return {
      exitCode: 0,
      summary: "No icon sets found",
      data: {
        command: "icons.generate",
        status: "success",
        generated: {
          components: 0,
          sets: 0,
        },
      },
    };
  }

  for (const set of iconSets) {
    const result = await processIconSet(set, logger);
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
      command: "icons.generate",
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

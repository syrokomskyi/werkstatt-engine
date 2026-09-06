import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(__dirname, "..", "..");
const ledgerPath = join(workspaceRoot, ".flaky-tests.json");

// Intentionally duplicated in packages/werkstatt-site/vitest.config.ts — vitest configs
// must be self-contained (config-time, no workspace package imports) and the function is
// small enough that a shared module + subpath export would add more complexity than it removes.
function getQuarantinedExcludes(packageDir: string): string[] {
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf-8"));
    if (!ledger.tests) return [];
    return ledger.tests
      .filter((t: { file: string }) => t.file.startsWith(packageDir + "/"))
      .map((t: { file: string }) => t.file.replace(packageDir + "/", ""));
  } catch {
    return [];
  }
}

const packageDir = "packages/werkstatt-engine";
const quarantinedExcludes = getQuarantinedExcludes(packageDir);

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ...quarantinedExcludes],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["json", "json-summary", "text-summary", "html"],
      reportsDirectory: "./.coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/**/index.ts", "src/**/*.template.ts"],
    },
  },
});

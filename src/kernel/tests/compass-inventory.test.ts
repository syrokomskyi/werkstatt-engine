import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { createCompassInventoryEntries } from "../compass-inventory.ts";

const input = { argv: [], flags: {} };

test("createCompassInventoryEntries excludes generation templates but keeps authored neighbors", async () => {
  const root = await mkdtemp(join(tmpdir(), "compass-inventory-"));
  try {
    await mkdir(join(root, "packages", "sample", "src", "templates"), { recursive: true });
    await mkdir(join(root, "packages", "werkstatt", "src", "templates"), {
      recursive: true,
    });
    await writeFile(
      join(root, "packages", "sample", "src", "templates", "route.template.ts"),
      "export const template = '{{ROUTE}}';\n",
      "utf8",
    );
    await writeFile(
      join(root, "packages", "sample", "src", "index.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      join(root, "packages", "werkstatt", "src", "templates", "kernel.template.ts"),
      "export const template = '{{KERNEL}}';\n",
      "utf8",
    );
    await writeFile(
      join(root, "packages", "werkstatt", "src", "runtime.ts"),
      "export const runtime = 1;\n",
      "utf8",
    );

    const entries = await createCompassInventoryEntries(root, input);
    const template = entries.find(
      (entry) => entry.path === "packages/sample/src/templates/route.template.ts",
    );
    const authored = entries.find((entry) => entry.path === "packages/sample/src/index.ts");
    const osTemplate = entries.find(
      (entry) => entry.path === "packages/werkstatt/src/templates/kernel.template.ts",
    );
    const osAuthored = entries.find((entry) => entry.path === "packages/werkstatt/src/runtime.ts");

    expect(template?.authoringStatus).toBe("excluded");
    expect(template?.requiredScaffolding).toBe("none");
    expect(template?.exclusionReason).toBe("template-source");
    expect(authored?.authoringStatus).toBe("authored");
    expect(authored?.violations).toContain("missing MODULE_CONTRACT");
    expect(osTemplate?.workspaceName).toBe("werkstatt");
    expect(osTemplate?.authoringStatus).toBe("excluded");
    expect(osTemplate?.exclusionReason).toBe("template-source");
    expect(osAuthored?.workspaceName).toBe("werkstatt");
    expect(osAuthored?.layer).toBe("source");
    expect(osAuthored?.riskClass).toBe("low");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

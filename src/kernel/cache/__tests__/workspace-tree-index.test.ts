import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, describe } from "vitest";
import { buildWorkspaceTreeIndex, filterTreeIndex } from "../workspace-tree-index.ts";

describe("buildWorkspaceTreeIndex", () => {
  test("indexes files in a simple workspace", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "a.md"), "a");
    await fs.writeFile(path.join(ws, "b.ts"), "b");
    const index = await buildWorkspaceTreeIndex(ws);
    expect(index.size).toBe(2);
    expect(index.has("a.md")).toBe(true);
    expect(index.has("b.ts")).toBe(true);
  });

  test("entries have mtimeMs and size", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "file.md"), "hello world");
    const index = await buildWorkspaceTreeIndex(ws);
    const entry = index.get("file.md");
    expect(entry).toBeDefined();
    expect(typeof entry!.mtimeMs).toBe("number");
    expect(entry!.size).toBe(11);
  });

  test("excludes .git and node_modules by default", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "visible.md"), "v");
    await fs.mkdir(path.join(ws, ".git"));
    await fs.writeFile(path.join(ws, ".git", "config"), "c");
    await fs.mkdir(path.join(ws, "node_modules"));
    await fs.writeFile(path.join(ws, "node_modules", "pkg.json"), "{}");
    const index = await buildWorkspaceTreeIndex(ws);
    expect(index.has("visible.md")).toBe(true);
    expect(index.has(".git/config")).toBe(false);
    expect(index.has("node_modules/pkg.json")).toBe(false);
  });

  test("does not exclude dist/ or missions/", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.mkdir(path.join(ws, "dist"));
    await fs.writeFile(path.join(ws, "dist", "output.html"), "html");
    await fs.mkdir(path.join(ws, "missions"));
    await fs.writeFile(path.join(ws, "missions", "mission.md"), "m");
    const index = await buildWorkspaceTreeIndex(ws);
    expect(index.has("dist/output.html")).toBe(true);
    expect(index.has("missions/mission.md")).toBe(true);
  });

  test("indexes nested directories", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.mkdir(path.join(ws, "src", "commands"), { recursive: true });
    await fs.writeFile(path.join(ws, "src", "commands", "cmd.ts"), "c");
    await fs.writeFile(path.join(ws, "src", "index.ts"), "i");
    const index = await buildWorkspaceTreeIndex(ws);
    expect(index.has("src/commands/cmd.ts")).toBe(true);
    expect(index.has("src/index.ts")).toBe(true);
  });

  test("custom excludeDirs override defaults", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "keep.md"), "k");
    await fs.mkdir(path.join(ws, ".git"));
    await fs.writeFile(path.join(ws, ".git", "config"), "c");
    await fs.mkdir(path.join(ws, "exclude-me"));
    await fs.writeFile(path.join(ws, "exclude-me", "file.md"), "f");
    const index = await buildWorkspaceTreeIndex(ws, [".git", "exclude-me"]);
    expect(index.has("keep.md")).toBe(true);
    expect(index.has(".git/config")).toBe(false);
    expect(index.has("exclude-me/file.md")).toBe(false);
  });
});

describe("filterTreeIndex", () => {
  test("matches simple file pattern", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "a.md"), "a");
    await fs.writeFile(path.join(ws, "b.ts"), "b");
    const index = await buildWorkspaceTreeIndex(ws);
    const matched = filterTreeIndex(index, ["a.md"], ws, ws);
    expect(matched).toEqual([path.join(ws, "a.md")]);
  });

  test("matches glob patterns", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "a.md"), "a");
    await fs.writeFile(path.join(ws, "b.md"), "b");
    await fs.writeFile(path.join(ws, "c.ts"), "c");
    const index = await buildWorkspaceTreeIndex(ws);
    const matched = filterTreeIndex(index, ["*.md"], ws, ws);
    expect(matched).toHaveLength(2);
    expect(matched).toContain(path.join(ws, "a.md"));
    expect(matched).toContain(path.join(ws, "b.md"));
  });

  test("matches nested glob patterns", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.mkdir(path.join(ws, "src", "commands"), { recursive: true });
    await fs.writeFile(path.join(ws, "src", "commands", "a.ts"), "a");
    await fs.writeFile(path.join(ws, "src", "commands", "b.ts"), "b");
    await fs.writeFile(path.join(ws, "src", "index.ts"), "i");
    const index = await buildWorkspaceTreeIndex(ws);
    const matched = filterTreeIndex(index, ["src/commands/*.ts"], ws, ws);
    expect(matched).toHaveLength(2);
  });

  test("resolves app token relative to baseDir", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.mkdir(path.join(ws, "sites", "myapp"), { recursive: true });
    await fs.writeFile(path.join(ws, "sites", "myapp", "content.md"), "c");
    const index = await buildWorkspaceTreeIndex(ws);
    const baseDir = path.join(ws, "sites", "myapp");
    const matched = filterTreeIndex(index, ["<app>/content.md"], baseDir, ws);
    expect(matched).toEqual([path.join(ws, "sites", "myapp", "content.md")]);
  });

  test("returns sorted results", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "c.md"), "c");
    await fs.writeFile(path.join(ws, "a.md"), "a");
    await fs.writeFile(path.join(ws, "b.md"), "b");
    const index = await buildWorkspaceTreeIndex(ws);
    const matched = filterTreeIndex(index, ["*.md"], ws, ws);
    expect(matched).toEqual([path.join(ws, "a.md"), path.join(ws, "b.md"), path.join(ws, "c.md")]);
  });

  test("returns empty array for no matches", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "tree-index-"));
    await fs.writeFile(path.join(ws, "a.md"), "a");
    const index = await buildWorkspaceTreeIndex(ws);
    const matched = filterTreeIndex(index, ["*.ts"], ws, ws);
    expect(matched).toEqual([]);
  });
});

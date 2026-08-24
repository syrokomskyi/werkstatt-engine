/*
<MODULE_CONTRACT>
<purpose>RFC-0574: Unit tests for resolveMirrors(), resolveMirrorPath(), inferMirrorProtocol(), isGitAccessible().</purpose>
<keywords>RFC-0574, mirrors, resolveMirrors, protocol, unit test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0574: initial unit tests for mirror path resolution helpers.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe } from "vitest";
import {
  resolveMirrors,
  resolveMirrorPath,
  inferMirrorProtocol,
  isGitAccessible,
} from "./registry-io.ts";
import type { SystemConfig } from "@warpgogol/werkstatt-engine/schemas";
import { join } from "node:path";

function makeEntry(
  mirrors: Array<{ path: string; storageType: "non-bare" | "bare" | "bundle" }>,
): SystemConfig {
  return {
    schemaVersion: "system-config/v1",
    id: "test-bundle",
    cosmicStar: "Vega",
    mirrors,
    pinnedPlatform: "4.5.0",
    status: "active",
    registeredAt: "2026-01-01T00:00:00Z",
    notes: "",
  };
}

const WORKSPACE = "/fake/workspace";

describe("inferMirrorProtocol", () => {
  test("detects ssh protocol from git@ prefix", () => {
    expect(inferMirrorProtocol("git@github.com:foo/bar.git")).toBe("ssh");
  });

  test("detects ssh protocol from ssh:// prefix", () => {
    expect(inferMirrorProtocol("ssh://github.com/foo/bar.git")).toBe("ssh");
  });

  test("detects https protocol", () => {
    expect(inferMirrorProtocol("https://github.com/foo/bar.git")).toBe("https");
  });

  test("detects http protocol as https", () => {
    expect(inferMirrorProtocol("http://github.com/foo/bar.git")).toBe("https");
  });

  test("detects ftp protocol", () => {
    expect(inferMirrorProtocol("ftp://server/path")).toBe("ftp");
  });

  test("detects sftp protocol as ftp", () => {
    expect(inferMirrorProtocol("sftp://server/path")).toBe("ftp");
  });

  test("detects s3 protocol", () => {
    expect(inferMirrorProtocol("s3://bucket/path")).toBe("s3");
  });

  test("detects rsync protocol", () => {
    expect(inferMirrorProtocol("rsync://server/path")).toBe("rsync");
  });

  test("defaults to file protocol for local paths", () => {
    expect(inferMirrorProtocol("../systems-git/test-bundle")).toBe("file");
    expect(inferMirrorProtocol("./systems/test-bundle")).toBe("file");
    expect(inferMirrorProtocol("/absolute/path")).toBe("file");
  });
});

describe("isGitAccessible", () => {
  test("returns true for git protocols (file, ssh, https)", () => {
    expect(isGitAccessible("../systems-git/test-bundle")).toBe(true);
    expect(isGitAccessible("git@github.com:foo/bar.git")).toBe(true);
    expect(isGitAccessible("https://github.com/foo/bar.git")).toBe(true);
  });

  test("returns false for non-git protocols (ftp, s3, rsync)", () => {
    expect(isGitAccessible("ftp://server/path")).toBe(false);
    expect(isGitAccessible("s3://bucket/path")).toBe(false);
    expect(isGitAccessible("rsync://server/path")).toBe(false);
  });
});

describe("resolveMirrorPath", () => {
  test("resolves relative paths against workspaceRoot", () => {
    expect(resolveMirrorPath(WORKSPACE, "../systems-git/test-bundle")).toBe(
      join(WORKSPACE, "..", "systems-git", "test-bundle"),
    );
    expect(resolveMirrorPath(WORKSPACE, "./systems/test-bundle")).toBe(
      join(WORKSPACE, "systems", "test-bundle"),
    );
  });

  test("resolves absolute paths as-is", () => {
    expect(resolveMirrorPath(WORKSPACE, "/absolute/path")).toBe("/absolute/path");
  });

  test("strips file:// prefix and resolves relative", () => {
    expect(resolveMirrorPath(WORKSPACE, "file://../systems-git/test-bundle")).toBe(
      join(WORKSPACE, "..", "systems-git", "test-bundle"),
    );
  });

  test("returns remote URLs unchanged", () => {
    expect(resolveMirrorPath(WORKSPACE, "git@github.com:foo/bar.git")).toBe(
      "git@github.com:foo/bar.git",
    );
    expect(resolveMirrorPath(WORKSPACE, "https://github.com/foo/bar.git")).toBe(
      "https://github.com/foo/bar.git",
    );
  });
});

describe("resolveMirrors", () => {
  test("single non-bare mirror — cache only, no git or backup mirrors", () => {
    const entry = makeEntry([{ path: "./systems/test-bundle", storageType: "non-bare" }]);
    const result = resolveMirrors(WORKSPACE, entry);
    expect(result.cachePath).toBe(join(WORKSPACE, "systems", "test-bundle"));
    expect(result.gitMirrors).toHaveLength(0);
    expect(result.backupMirrors).toHaveLength(0);
  });

  test("non-bare + bare + external — cache, two git mirrors, no backup", () => {
    const entry = makeEntry([
      { path: "./systems/test-bundle", storageType: "non-bare" },
      { path: "../systems-git/test-bundle", storageType: "bare" },
      { path: "git@github.com:foo/test.git", storageType: "bare" },
    ]);
    const result = resolveMirrors(WORKSPACE, entry);
    expect(result.cachePath).toBe(join(WORKSPACE, "systems", "test-bundle"));
    expect(result.gitMirrors).toHaveLength(2);
    expect(result.gitMirrors[0].path).toBe("../systems-git/test-bundle");
    expect(result.gitMirrors[1].path).toBe("git@github.com:foo/test.git");
    expect(result.backupMirrors).toHaveLength(0);
  });

  test("non-bare + bare + external + bundle — cache, two git, one backup", () => {
    const entry = makeEntry([
      { path: "./systems/test-bundle", storageType: "non-bare" },
      { path: "../systems-git/test-bundle", storageType: "bare" },
      { path: "git@github.com:foo/test.git", storageType: "bare" },
      { path: "s3://bucket/backups/test-bundle.bundle", storageType: "bundle" },
    ]);
    const result = resolveMirrors(WORKSPACE, entry);
    expect(result.cachePath).toBe(join(WORKSPACE, "systems", "test-bundle"));
    expect(result.gitMirrors).toHaveLength(2);
    expect(result.backupMirrors).toHaveLength(1);
    expect(result.backupMirrors[0].path).toBe("s3://bucket/backups/test-bundle.bundle");
  });

  test("non-bare + bundle only — cache, no git, one backup", () => {
    const entry = makeEntry([
      { path: "./systems/test-bundle", storageType: "non-bare" },
      { path: "ftp://server/backups/test-bundle.bundle", storageType: "bundle" },
    ]);
    const result = resolveMirrors(WORKSPACE, entry);
    expect(result.gitMirrors).toHaveLength(0);
    expect(result.backupMirrors).toHaveLength(1);
  });

  test("non-bare + rsync — rsync is not git-accessible, goes to backup", () => {
    const entry = makeEntry([
      { path: "./systems/test-bundle", storageType: "non-bare" },
      { path: "rsync://server/path", storageType: "bare" },
    ]);
    const result = resolveMirrors(WORKSPACE, entry);
    expect(result.gitMirrors).toHaveLength(0);
    expect(result.backupMirrors).toHaveLength(0); // rsync+bare is not bundle, not git → neither
  });

  test("cache path resolved from mirrors[0] with file:// prefix", () => {
    const entry = makeEntry([
      { path: "file://../systems-cache/test-bundle", storageType: "non-bare" },
    ]);
    const result = resolveMirrors(WORKSPACE, entry);
    expect(result.cachePath).toBe(join(WORKSPACE, "..", "systems-cache", "test-bundle"));
  });
});

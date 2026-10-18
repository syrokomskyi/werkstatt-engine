/*
<MODULE_CONTRACT>
<purpose>Vitest setup for werkstatt-engine — gives fixture git repositories a deterministic identity and default branch when the host git config lacks them.</purpose>
<non-goals>
  <item>Does not override an identity or default branch the host already configures.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1254: standalone CI runners have no global git identity; fixture commits failed with "empty ident name".</item>
</CHANGE_SUMMARY>
*/

import { execFileSync } from "node:child_process";

function gitConfig(key: string): string {
  try {
    return execFileSync("git", ["config", "--get", key], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

if (!process.env["GIT_AUTHOR_NAME"] && !gitConfig("user.name")) {
  process.env["GIT_AUTHOR_NAME"] = "werkstatt-test";
  process.env["GIT_COMMITTER_NAME"] = "werkstatt-test";
}
if (!process.env["GIT_AUTHOR_EMAIL"] && !gitConfig("user.email")) {
  process.env["GIT_AUTHOR_EMAIL"] = "werkstatt-test@example.invalid";
  process.env["GIT_COMMITTER_EMAIL"] = "werkstatt-test@example.invalid";
}
if (!process.env["GIT_CONFIG_COUNT"] && !gitConfig("init.defaultBranch")) {
  process.env["GIT_CONFIG_COUNT"] = "1";
  process.env["GIT_CONFIG_KEY_0"] = "init.defaultBranch";
  process.env["GIT_CONFIG_VALUE_0"] = "main";
}

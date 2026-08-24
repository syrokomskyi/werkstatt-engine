#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(__dirname, "..", "src", "kernel", "cli", "index.ts");

const require = createRequire(import.meta.url);
const tsxLoaderUrl = pathToFileURL(require.resolve("tsx")).href;

const child = spawn(
  process.execPath,
  ["--import", tsxLoaderUrl, cliEntry, ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

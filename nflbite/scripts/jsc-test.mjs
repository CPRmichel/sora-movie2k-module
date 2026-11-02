import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fixturePages } from "../test/fixtures.mjs";

await mkdir("test-results", { recursive: true });
await writeFile("test-results/jsc-fixtures.json", JSON.stringify(fixturePages()));
const result = spawnSync("swift", [
  "-module-cache-path", "/private/tmp/luna-nflbite-swift-cache",
  "scripts/test-jsc.swift", "nflbite.js", "test-results/jsc-fixtures.json",
], { stdio: "inherit", timeout: 60000 });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

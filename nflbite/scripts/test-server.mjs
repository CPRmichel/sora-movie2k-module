import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";

const child = spawn(process.execPath, ["scripts/serve.mjs"], { stdio: ["ignore", "pipe", "pipe"] });
const ended = once(child, "exit");
let errors = "";
child.stderr.on("data", (chunk) => { errors += chunk; });
try {
  await Promise.race([
    once(child.stdout, "data"),
    ended.then(() => { throw new Error(errors || "Server exited"); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Startup timeout")), 5000).unref()),
  ]);
  const metadataResponse = await fetch("http://127.0.0.1:8787/nflbite.json");
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.sourceName, "NFLBite");
  assert.equal(metadata.scriptUrl, "http://127.0.0.1:8787/nflbite.js");
  const script = await fetch(metadata.scriptUrl);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /function searchResults/);
  const otherFile = await fetch("http://127.0.0.1:8787/package.json");
  assert.equal(otherFile.status, 404);
  console.log("PASS: local metadata/script downloads; other files inaccessible");
} finally {
  child.kill("SIGTERM");
  await ended;
}

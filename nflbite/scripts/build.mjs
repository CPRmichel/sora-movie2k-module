import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: ["src/module.js"],
  outfile: "nflbite.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "NFLBite",
  inject: ["src/base64.js"],
  target: "safari16",
  minify: true,
  legalComments: "eof",
  footer: {
    js: "function searchResults(q){return NFLBite.searchResults(q);}\nfunction extractDetails(u){return NFLBite.extractDetails(u);}\nfunction extractEpisodes(u){return NFLBite.extractEpisodes(u);}\nfunction extractStreamUrl(u){return NFLBite.extractStreamUrl(u);}",
  },
});

const root = new URL("../", import.meta.url);
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
const notices = [];
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path) continue;
  for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENSE-MIT.txt"]) {
    try {
      const license = await readFile(new URL(path + "/" + filename, root), "utf8");
      notices.push(path + " @ " + metadata.version + "\n" + license.replace(/[ \t]+$/gm, "").trim());
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
await writeFile(new URL("THIRD_PARTY_NOTICES.txt", root), notices.join("\n\n====================\n\n") + "\n");

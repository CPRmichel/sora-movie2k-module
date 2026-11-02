import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
  ["/nflbite.json", [new URL("../nflbite.json", import.meta.url), "application/json"]],
  ["/nflbite.js", [new URL("../nflbite.js", import.meta.url), "text/javascript"]],
]);

const server = createServer(async (request, response) => {
  const file = files.get(request.url);
  if (!file || !["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    let body = await readFile(file[0]);
    if (request.url === "/nflbite.json") {
      const metadata = JSON.parse(body.toString("utf8"));
      metadata.scriptUrl = "http://127.0.0.1:8787/nflbite.js";
      body = Buffer.from(JSON.stringify(metadata, null, 2) + "\n");
    }
    response.writeHead(200, { "Content-Type": file[1] + "; charset=utf-8", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(500).end("Run npm run build first");
  }
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(8787, "127.0.0.1", () => {
  console.log("Local development module: http://127.0.0.1:8787/nflbite.json");
});

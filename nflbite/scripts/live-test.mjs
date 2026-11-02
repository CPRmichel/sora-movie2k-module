import { mkdir, writeFile } from "node:fs/promises";
import { runtime } from "../test/runtime.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const query = process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "NFL";
const playback = process.argv.includes("--playback");
const resolve = process.argv.includes("--resolve") || playback;
await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
const requests = [];
const started = Date.now();
const { context, logs } = await runtime(async (url, headers) => {
  const time = Date.now();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  const body = await response.text();
  requests.push({ url, status: response.status, bytes: Buffer.byteLength(body), elapsedMs: Date.now() - time });
  return { status: response.status, text: async () => body };
});

const report = { timestamp: new Date().toISOString(), query, playbackTested: false, steps: [], requests, logs };
try {
  const events = JSON.parse(await context.searchResults(query));
  report.steps.push({ name: "searchResults", count: events.length, events });
  if (!events.length) throw new Error("No matching events in the current schedule");
  const href = events[0].href;
  report.steps.push({ name: "extractDetails", result: JSON.parse(await context.extractDetails(href)) });
  report.steps.push({ name: "extractEpisodes", result: JSON.parse(await context.extractEpisodes(href)) });
  const providers = await context.NFLBite.listProviders(href);
  report.steps.push({ name: "providers", count: providers.length, providers });
  if (!providers.length) throw new Error("The selected event has no listed providers");
  if (resolve) {
    const result = JSON.parse(await context.extractStreamUrl(href));
    const probes = [];
    for (const stream of result.streams) {
      try {
        const response = await fetch(stream.url, { headers: stream.headers, signal: AbortSignal.timeout(8000) });
        const reader = response.body?.getReader();
        let prefix = "";
        try {
          const chunk = await reader?.read();
          prefix = new TextDecoder().decode(chunk?.value).trimStart();
        } finally {
          await reader?.cancel();
        }
        probes.push({ status: response.status, contentType: response.headers.get("content-type"), manifestRecognized: prefix.startsWith("#EXTM3U") || /<MPD[\s>]/.test(prefix) });
      } catch (error) {
        probes.push({ error: error.message, manifestRecognized: false });
      }
    }
    report.steps.push({ name: "extractStreamUrl", count: result.streams.length, probes });
    if (!probes.some((probe) => probe.status === 200 && probe.manifestRecognized)) throw new Error("Candidates found, but no working HLS/DASH manifest confirmed");
    if (playback) {
      const selected = result.streams[probes.findIndex((probe) => probe.status === 200 && probe.manifestRecognized)];
      const output = fileURLToPath(new URL("../test-results/playback.jpg", import.meta.url));
      const headers = Object.entries(selected.headers).map(([name, value]) => name + ": " + value + "\r\n").join("");
      const decode = spawnSync("ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-rw_timeout", "8000000", "-headers", headers, "-i", selected.url,
        "-map", "0:v:0", "-frames:v", "1", "-update", "1", output,
      ], { encoding: "utf8", timeout: 25000, maxBuffer: 65536 });
      report.steps.push({ name: "decodeVideoFrame", ok: decode.status === 0, engine: "FFmpeg, not the Luna app", image: output });
      if (decode.status !== 0) throw new Error("Video decoding failed: " + (decode.error?.message || decode.stderr.slice(-800)));
      report.playbackTested = true;
    }
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.message;
  process.exitCode = 1;
}
report.elapsedMs = Date.now() - started;
const output = new URL("../test-results/live.json", import.meta.url);
await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  ok: report.ok,
  query,
  steps: report.steps.map(({ name, count, probes, ok, image, engine }) => ({ name, count, probes, ok, image, engine })),
  requests: requests.length,
  elapsedMs: report.elapsedMs,
  playbackTested: report.playbackTested,
  error: report.error,
  report: fileURLToPath(output),
}, null, 2));

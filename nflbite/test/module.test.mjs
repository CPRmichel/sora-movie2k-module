import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixtureRuntime } from "./runtime.mjs";
import { fixturePages, homeURL, eventURL, redzoneURL, providerURL, embedURL, streamURL } from "./fixtures.mjs";

test("metadata matches Luna's required ServiceMetadata fields", async () => {
  const metadata = JSON.parse(await readFile(new URL("../nflbite.json", import.meta.url)));
  for (const key of ["sourceName", "iconUrl", "version", "language", "baseUrl", "streamType", "quality", "searchBaseUrl", "scriptUrl"]) {
    assert.equal(typeof metadata[key], "string", key);
  }
  assert.equal(metadata.author.name.length > 0, true);
  assert.equal(typeof metadata.author.icon, "string");
  assert.equal(metadata.asyncJS, true);
  assert.equal(metadata.downloadSupport, false);
  assert.equal(metadata.supportsLuna, true);
  assert.equal(metadata.scriptUrl, "https://raw.githubusercontent.com/CPRmichel/sora-movie2k-module/main/nflbite/nflbite.js");
});

test("bundle works without Node, DOM, fetch, URL or timer globals", async () => {
  const { context } = await fixtureRuntime(fixturePages());
  for (const name of ["searchResults", "extractDetails", "extractEpisodes", "extractStreamUrl"]) {
    assert.equal(typeof context[name], "function");
  }
  const results = JSON.parse(await context.searchResults("NFL"));
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "NFL RedZone");
  assert.equal(results[0].image, "https://www.nflbite.is/images/teams/NFL%20Redzone.png");
});

test("RedZone accepts spaced, hyphenated and case-insensitive search aliases", async () => {
  const { context } = await fixtureRuntime(fixturePages());
  for (const query of ["RedZone", "redzone", "NFL RedZone", "Red Zone", "NFL RED ZONE", "NFL Red-Zone"]) {
    const results = JSON.parse(await context.searchResults(query));
    assert.equal(results.length, 1, query);
    assert.equal(results[0].title, "NFL RedZone");
    assert.equal(results[0].href, redzoneURL);
  }
});

test("RedZone is prioritized even when the website lists games first", async () => {
  const pages = fixturePages();
  pages[homeURL].body = `<a href="${eventURL}">Jets</a><a href="${redzoneURL}">RedZone</a>`;
  const { context } = await fixtureRuntime(pages);
  const results = JSON.parse(await context.searchResults("NFL"));
  assert.deepEqual(results.map((result) => result.href), [redzoneURL, eventURL]);
});

test("RedZone details do not describe the channel as a match against Live", async () => {
  const { context } = await fixtureRuntime(fixturePages());
  const details = JSON.parse(await context.extractDetails(redzoneURL));
  assert.match(details[0].description, /^NFL RedZone\./);
  assert.doesNotMatch(details[0].description, /vs\. Live/);
});

test("missing RedZone is not replaced with an individual game or a stale URL", async () => {
  const pages = fixturePages();
  pages[homeURL].body = `<a href="${eventURL}">Jets</a>`;
  const { context } = await fixtureRuntime(pages);
  assert.deepEqual(JSON.parse(await context.searchResults("Red Zone")), []);
});

test("search filters all query words and excludes navigation/duplicate/foreign links", async () => {
  const { context } = await fixtureRuntime(fixturePages());
  for (const query of ["Jets", "NEW york", "las vegas", "jets raiders"]) {
    const results = JSON.parse(await context.searchResults(query));
    assert.equal(results.length, 1);
    assert.equal(results[0].href, eventURL);
  }
  assert.equal(JSON.parse(await context.searchResults("Packers")).length, 0);
  assert.equal(JSON.parse(await context.searchResults("")).length, 2);
});

test("details and live episode conform to Luna's response schema", async () => {
  const { context } = await fixtureRuntime(fixturePages());
  const details = JSON.parse(await context.extractDetails(eventURL));
  assert.equal(details.length, 1);
  assert.match(details[0].description, /New York Jets vs\. Las Vegas Raiders/);
  assert.match(details[0].description, /1 external providers/);
  assert.equal(details[0].airdate, "2026-11-01T17:00:00.000Z");
  assert.deepEqual(JSON.parse(await context.extractEpisodes(eventURL)), [{ number: 1, title: "Live", href: eventURL }]);
});

test("provider extraction preserves names, quality and language from malformed tables", async () => {
  const { context } = await fixtureRuntime(fixturePages());
  const providers = await context.NFLBite.listProviders(eventURL);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, "Example & Sports");
  assert.equal(providers[0].quality, "HD");
  assert.equal(providers[0].language, "English");
});

test("resolves iframe/config media, keeps headers, deduplicates and stops cycles", async () => {
  const { context, requests } = await fixtureRuntime(fixturePages());
  const result = JSON.parse(await context.extractStreamUrl(eventURL));
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0].url, streamURL);
  assert.equal(result.streams[0].streamUrl, result.streams[0].url);
  assert.equal(result.streams[0].headers.Referer, embedURL);
  assert.match(result.streams[0].headers["User-Agent"], /Safari/);
  assert.match(result.streams[0].title, /Example & Sports \| HD \| English/);
  assert.equal(requests.length, 4);
  assert.equal(requests[1].headers.Referer, eventURL);
  assert.equal(requests[2].headers.Referer, providerURL);
});

test("does not return HTML pages, blob URLs or custom transports as streams", async () => {
  const pages = fixturePages();
  pages[embedURL].body = `<script>var config={file:"vttp://nfl.com/redzone.m3u8",src:"blob:https://example.org/id"};var globalurl='redzone.m3u8';</script>`;
  const { context } = await fixtureRuntime(pages);
  await assert.rejects(context.extractStreamUrl(eventURL), /No directly playable/);
});

test("resolves literal variable references in Clappr/Hls configs without executing scripts", async () => {
  const pages = fixturePages();
  pages[embedURL].body = `<script>let streamUrl="${streamURL}"; const p = new Clappr.Player({source: streamUrl});</script>`;
  const { context } = await fixtureRuntime(pages);
  const result = JSON.parse(await context.extractStreamUrl(eventURL));
  assert.equal(result.streams[0].url, streamURL);
});

test("rejects blocked or HTML-disguised manifests instead of returning a broken source", async () => {
  for (const item of [{ status: 403, body: "Denied" }, { status: 200, body: "<html>Login required</html>" }]) {
    const pages = fixturePages();
    pages[streamURL] = item;
    const { context } = await fixtureRuntime(pages);
    await assert.rejects(context.extractStreamUrl(eventURL), /No directly playable/);
  }
});

test("denies local and private literal iframe destinations", async () => {
  const pages = fixturePages();
  pages[providerURL].body = `<iframe src="http://127.0.0.1:8080/admin"></iframe><iframe src="http://192.168.1.1/"></iframe><iframe src="http://localhost/"></iframe><iframe src="file:///etc/passwd"></iframe>`;
  const { context, requests } = await fixtureRuntime(pages);
  await assert.rejects(context.extractStreamUrl(eventURL), /No directly playable/);
  assert.equal(requests.length, 2);
});

test("HTTP failures are not disguised as empty successful searches and can be retried", async () => {
  const pages = fixturePages();
  pages[homeURL].status = 503;
  const { context } = await fixtureRuntime(pages);
  await assert.rejects(context.searchResults("NFL"), /HTTP 503/);
  pages[homeURL].status = 200;
  assert.equal(JSON.parse(await context.searchResults("NFL")).length, 2);
});

test("browser challenges report an unsupported source without bypass attempts", async () => {
  const pages = fixturePages();
  pages[homeURL].body = "<title>Just a moment...</title><div id='cf-chl-widget'></div>";
  const { context, requests } = await fixtureRuntime(pages);
  await assert.rejects(context.searchResults("NFL"), /browser challenge/);
  assert.equal(requests.length, 1);
});

test("parallel requests for the same page share one short-lived request", async () => {
  const { context, requests } = await fixtureRuntime(fixturePages());
  await Promise.all([context.searchResults("NFL"), context.searchResults("Jets"), context.searchResults("Raiders")]);
  assert.equal(requests.length, 1);
});

test("foreign event URLs are rejected before any network request", async () => {
  const { context, requests } = await fixtureRuntime(fixturePages());
  await assert.rejects(context.extractDetails("https://evil.example/A-vs-B/123"), /Not an NFLBite/);
  assert.equal(requests.length, 0);
});

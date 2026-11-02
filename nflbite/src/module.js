import { parseDocument } from "htmlparser2";
import { selectAll, selectOne } from "css-select";
import { textContent } from "domutils";
import URLParse from "url-parse";
import { parse } from "acorn";
import { simple } from "acorn-walk";

const HOME = "https://www.nflbite.is/";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const pageCache = new Map();
const CACHE_MS = 30000;

function absolute(value, base) {
  if (!value || typeof value !== "string") return null;
  let url;
  try {
    url = new URLParse(value.trim(), base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // Reject obvious local targets; DNS/redirect policy belongs to the native fetch layer.
  if (!host.includes(".") || /\.(?:localhost|local|internal|lan|home)$/.test(host) || host.includes(":")) return null;
  if (/^[\d.]+$/.test(host)) return null;
  url.set("hash", "");
  url.set("pathname", url.pathname.replace(/ /g, "%20"));
  return url.href;
}

function eventURL(value) {
  const url = absolute(value, HOME);
  if (!url) return null;
  const parsed = new URLParse(url);
  return /^(?:links\.nflbite\.run|(?:www\.)?nflbite\.is)$/.test(parsed.hostname)
    && /\/(?:[^/]+-vs-[^/]+)\/\d+\/?$/i.test(parsed.pathname) ? url : null;
}

function text(node) {
  return node ? textContent(node).replace(/\s+/g, " ").trim() : "";
}

function normalized(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\bred zone\b/g, "redzone");
}

function displayTitle(value) {
  return value.replace(/ vs\. Live$/i, "").replace(/\bNFL Red\s*Zone\b/i, "NFL RedZone");
}

async function page(url, referer = HOME) {
  const cached = pageCache.get(url);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.promise;
  const promise = (async () => {
    const response = await fetchv2(url, {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      Referer: referer,
    });
    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error("NFLBite request failed (HTTP " + (response?.status || "network error") + ")");
    }
    const html = await response.text();
    if (typeof html !== "string" || !html.trim() || html.length > 2000000) {
      throw new Error("NFLBite returned an empty or oversized page");
    }
    if (/cf-chl-|Just a moment\.\.\.|captcha-container/i.test(html)) {
      throw new Error("Provider requires a browser challenge; not bypassed by this module");
    }
    return parseDocument(html);
  })();
  if (pageCache.size >= 32) pageCache.delete(pageCache.keys().next().value);
  pageCache.set(url, { time: Date.now(), promise });
  try {
    return await promise;
  } catch (error) {
    pageCache.delete(url);
    throw error;
  }
}

export function parseEvents(document) {
  const seen = new Set();
  return selectAll("a[href]", document).flatMap((anchor) => {
    const href = eventURL(anchor.attribs.href);
    if (!href || seen.has(href)) return [];
    seen.add(href);
    const slug = new URLParse(href).pathname.split("/").filter(Boolean)[0];
    let decoded;
    try { decoded = decodeURIComponent(slug); } catch { return []; }
    const title = displayTitle(decoded.replace(/-vs-/i, " vs. ").replace(/-/g, " "));
    const images = selectAll("img[src]", anchor);
    const image = images.find((item) => !/\/Live\.png$/i.test(item.attribs.src)) || images[0];
    return [{
      title,
      image: absolute(image?.attribs.src, HOME) || HOME + "images/nfllogo.png",
      href,
    }];
  });
}

export async function searchResults(query) {
  const events = parseEvents(await page(HOME));
  const words = normalized(query).split(" ").filter(Boolean);
  const showAll = !words.length || ["nfl", "live", "all", "football", "nflbite"].includes(normalized(query));
  const results = events.filter((event) => showAll || words.every((word) => normalized(event.title).includes(word)));
  results.sort((a, b) => Number(normalized(b.title) === "nfl redzone") - Number(normalized(a.title) === "nfl redzone"));
  return JSON.stringify(results);
}

export async function extractDetails(url) {
  const href = eventURL(url);
  if (!href) throw new Error("Not an NFLBite event URL");
  const document = await page(href);
  const teams = selectAll("h5", document).map(text).filter(Boolean).slice(0, 2);
  const title = displayTitle(teams.join(" vs. ") || text(selectOne("title", document)));
  let airdate = "";
  for (const script of selectAll("script:not([src])", document)) {
    const stamp = textContent(script).match(/\b(?:var|let|const)\s+sttime\s*=\s*["']?(\d{10})/);
    if (stamp) airdate = new Date(Number(stamp[1]) * 1000).toISOString();
  }
  const providers = parseProviders(document, href);
  return JSON.stringify([{
    description: title + ". NFL live event. " + providers.length + " external providers listed. Availability and quality depend on the provider.",
    aliases: teams.join(", "),
    airdate,
  }]);
}

export async function extractEpisodes(url) {
  const href = eventURL(url);
  if (!href) throw new Error("Not an NFLBite event URL");
  return JSON.stringify([{ number: 1, title: "Live", href }]);
}

export function parseProviders(document, base) {
  const seen = new Set();
  const providers = [];
  const add = (rawURL, name, quality, language) => {
    const url = absolute(rawURL, base);
    if (!url || seen.has(url)) return;
    seen.add(url);
    providers.push({ url, name: name || new URLParse(url).hostname, quality: quality || "", language: language || "" });
  };
  for (const row of selectAll("tr", document)) {
    const input = selectOne('input[id^="linkk"][value]', row);
    if (!input) continue;
    const cells = selectAll("td", row).map(text);
    add(input.attribs.value, cells[1], cells[3], cells[4]);
  }
  for (const anchor of selectAll(".premium-stream-row a[href]", document)) {
    const columns = selectAll(".row > div", anchor).map(text);
    add(anchor.attribs.href, columns[0], columns[3], columns[5]);
  }
  return providers;
}

export async function listProviders(url) {
  const href = eventURL(url);
  if (!href) throw new Error("Not an NFLBite event URL");
  return parseProviders(await page(href), href);
}

function mediaURL(value, base) {
  const url = absolute(value, base);
  return url && /\.(?:m3u8|mpd|mp4)(?:\?|$)/i.test(url) ? url : null;
}

export function playerLinks(document, base) {
  const media = new Set();
  const frames = new Set();
  for (const element of selectAll("video[src], source[src]", document)) {
    const url = mediaURL(element.attribs.src, base);
    if (url) media.add(url);
  }
  for (const frame of selectAll("iframe[src], iframe[data-src]", document)) {
    const url = absolute(frame.attribs.src || frame.attribs["data-src"], base);
    if (url && !/youtube\.com\/live_chat|doubleclick\.|googlesyndication\./i.test(url)) frames.add(url);
  }
  // Inspect literal configuration only. Never execute third-party scripts or ads.
  for (const script of selectAll("script:not([src])", document)) {
    const source = textContent(script);
    if (source.length > 150000) continue;
    try {
      const tree = parse(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
      const bindings = new Map();
      const ambiguous = new Set();
      simple(tree, {
        VariableDeclarator(node) {
          if (node.id.type !== "Identifier") return;
          if (bindings.has(node.id.name)) ambiguous.add(node.id.name);
          if (node.init?.type === "Literal" && typeof node.init.value === "string") bindings.set(node.id.name, node.init.value);
        },
      });
      const addMedia = (node) => {
        const value = node?.type === "Literal" ? node.value
          : node?.type === "Identifier" && !ambiguous.has(node.name) ? bindings.get(node.name) : null;
        if (typeof value !== "string") return;
        const url = mediaURL(value, base);
        if (url) media.add(url);
      };
      simple(tree, {
        Property(node) {
          const key = node.key.name || node.key.value;
          if (/^(?:file|src|source|hls|dash|manifest|manifestUrl|streamUrl|url)$/i.test(key)) addMedia(node.value);
        },
        CallExpression(node) {
          if (node.callee.type === "MemberExpression" && /^(?:load|loadSource)$/.test(node.callee.property.name)) addMedia(node.arguments[0]);
        },
      });
    } catch {
      // Unparseable and obfuscated players stay unsupported, rather than evaluated.
    }
  }
  return { media: [...media], frames: [...frames] };
}

export async function extractStreamUrl(url) {
  const href = eventURL(url);
  if (!href) throw new Error("Not an NFLBite event URL");
  const providers = await listProviders(href);
  const visited = new Set();
  const streams = [];
  const seenStreams = new Set();
  const failures = [];
  const started = Date.now();
  async function visit(target, referer, provider, depth) {
    if (visited.has(target) || visited.size >= 18 || depth > 5 || Date.now() - started > 15000) return;
    visited.add(target);
    const direct = mediaURL(target, referer);
    if (direct) {
      add(direct, referer, provider);
      return;
    }
    try {
      const links = playerLinks(await page(target, referer), target);
      links.media.forEach((link) => add(link, target, provider));
      for (const frame of links.frames.slice(0, 3)) {
        if (streams.length >= 4) break;
        await visit(frame, target, provider, depth + 1);
      }
    } catch (error) {
      failures.push(provider.name + ": " + error.message);
    }
  }
  function add(streamURL, referer, provider) {
    if (seenStreams.has(streamURL)) return;
    seenStreams.add(streamURL);
    streams.push({
      url: streamURL,
      streamUrl: streamURL,
      title: [provider.name, provider.quality, provider.language].filter(Boolean).join(" | "),
      headers: { Referer: referer, "User-Agent": USER_AGENT },
    });
  }
  for (const provider of providers.slice(0, 6)) {
    if (streams.length >= 4) break;
    await visit(provider.url, href, provider, 0);
  }
  const playable = [];
  for (const stream of streams) {
    if (/\.mp4(?:\?|$)/i.test(stream.url)) {
      playable.push(stream);
      continue;
    }
    try {
      const response = await fetchv2(stream.url, stream.headers);
      if (response.status !== 200) continue;
      const manifest = (await response.text()).trimStart();
      if (manifest.startsWith("#EXTM3U") || /<MPD[\s>]/.test(manifest)) playable.push(stream);
    } catch {
      // A dead provider must not hide a working fallback.
    }
  }
  if (!playable.length) {
    console.log("NFLBite: " + providers.length + " providers, " + visited.size + " pages checked. " + failures.slice(0, 3).join("; "));
    throw new Error("No directly playable HLS/DASH/MP4 source found. Providers may use unsupported JavaScript, custom transports, browser challenges, or be offline. HTML pages are not playable streams.");
  }
  return JSON.stringify({ streams: playable, subtitles: [] });
}

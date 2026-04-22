var MOFLIX_BASE_URL = "https://moflix-stream.xyz/";

async function searchResults(keyword) {
  try {
    const query = cleanupText(keyword);
    if (!query) {
      return JSON.stringify([]);
    }

    const response = await moflixFetch(
      MOFLIX_BASE_URL + "search/" + encodeURIComponent(query)
    );
    const html = await readResponseText(response);
    const bootstrapData = parseBootstrapData(html) || {};
    const searchPage = getSearchPage(bootstrapData);
    const results = [];
    const seen = {};
    const hrefMap = extractSearchHrefMap(html);

    if (Array.isArray(searchPage.results) && searchPage.results.length) {
      for (let i = 0; i < searchPage.results.length; i += 1) {
        const item = searchPage.results[i];
        if (!item || item.model_type !== "title") {
          continue;
        }

        const href = absolutizeUrl(
          hrefMap[String(item.id)] || buildTitleHref(item)
        );
        if (!href || seen[href]) {
          continue;
        }

        seen[href] = true;
        results.push({
          title: cleanupText(item.name),
          image: absolutizeUrl(item.poster),
          href: href
        });
      }
    } else {
      const regex =
        /<a class="contents" href="(\/titles\/[^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="Poster for ([^"]+)"/gi;

      let match;
      while ((match = regex.exec(html)) !== null) {
        const href = absolutizeUrl(match[1]);
        if (!href || seen[href]) {
          continue;
        }

        seen[href] = true;
        results.push({
          title: cleanupText(decodeHtml(match[3])),
          image: absolutizeUrl(match[2]),
          href: href
        });
      }
    }

    return JSON.stringify(results);
  } catch (error) {
    console.log("searchResults error: " + error.message);
    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const html = await fetchHtml(url);
    const bootstrapData = parseBootstrapData(html) || {};
    const titlePage = getTitlePage(bootstrapData);
    const watchPage = getWatchPage(bootstrapData);
    const title = titlePage.title || (watchPage.video && watchPage.video.title) || watchPage.title || {};

    const genres = extractNames(title.genres);
    const countries = extractCountryNames(title.production_countries || title.countries);
    const runtime = title.runtime || (watchPage.episode && watchPage.episode.runtime) || "Unknown";
    const year = title.year || extractYear(title.release_date) || "Unknown";
    const description = cleanupText(title.description) || "No description available";

    return JSON.stringify([
      {
        description: description,
        aliases: [
          "Genres: " + (genres.length ? genres.join(", ") : "Unknown"),
          "Runtime: " + formatRuntime(runtime),
          "Country: " + (countries.length ? countries.join(", ") : "Unknown")
        ].join(" | "),
        airdate: String(year)
      }
    ]);
  } catch (error) {
    console.log("extractDetails error: " + error.message);
    return JSON.stringify([
      {
        description: "Error loading description",
        aliases: "Genres: Unknown | Runtime: Unknown | Country: Unknown",
        airdate: "Unknown"
      }
    ]);
  }
}

async function extractEpisodes(url) {
  try {
    const html = await fetchHtml(url);
    const bootstrapData = parseBootstrapData(html) || {};
    const titlePage = getTitlePage(bootstrapData);
    const title = titlePage.title || {};
    const episodes = Array.isArray(titlePage.episodes && titlePage.episodes.data)
      ? titlePage.episodes.data.slice()
      : [];

    if (!episodes.length) {
      const movieVideoId = getMovieVideoId(titlePage);
      if (!movieVideoId) {
        return JSON.stringify([]);
      }

      return JSON.stringify([
        {
          href: absolutizeUrl("/watch/" + movieVideoId),
          number: "Movie"
        }
      ]);
    }

    episodes.sort(function(a, b) {
      if (toNumber(a.season_number) !== toNumber(b.season_number)) {
        return toNumber(a.season_number) - toNumber(b.season_number);
      }
      return toNumber(a.episode_number) - toNumber(b.episode_number);
    });

    return JSON.stringify(
      episodes
        .filter(function(item) {
          return item && item.primary_video && item.primary_video.id;
        })
        .map(function(item) {
          return {
            href: absolutizeUrl("/watch/" + item.primary_video.id),
            number:
              "S" +
              padNumber(item.season_number) +
              "E" +
              padNumber(item.episode_number) +
              (item.name ? " - " + cleanupText(item.name) : "")
          };
        })
    );
  } catch (error) {
    console.log("extractEpisodes error: " + error.message);
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  try {
    const watchUrl = await ensureWatchUrl(url);
    if (!watchUrl) {
      return null;
    }

    const html = await fetchHtml(watchUrl);
    const bootstrapData = parseBootstrapData(html) || {};
    const watchPage = getWatchPage(bootstrapData);
    const videoList = collectWatchVideos(watchPage);
    if (!videoList.length) {
      return null;
    }

    const resolved = [];
    for (let i = 0; i < videoList.length; i += 1) {
      const video = videoList[i];
      const resolvedUrl = await resolveMirror(video.src);
      if (!resolvedUrl) {
        continue;
      }

      resolved.push({
        provider: detectProvider(video.src),
        quality: video.quality || "Unknown",
        link: resolvedUrl
      });
    }

    if (!resolved.length) {
      return null;
    }

    resolved.sort(function(a, b) {
      return scoreStream(b) - scoreStream(a);
    });

    console.log("Selected Moflix stream: " + resolved[0].link);
    return resolved[0].link;
  } catch (error) {
    console.log("extractStreamUrl error: " + error.message);
    return null;
  }
}

async function ensureWatchUrl(url) {
  const cleanUrl = stripHash(url);
  if (cleanUrl.indexOf("/watch/") !== -1) {
    return cleanUrl;
  }

  const html = await fetchHtml(cleanUrl);
  const bootstrapData = parseBootstrapData(html) || {};
  const titlePage = getTitlePage(bootstrapData);
  const movieVideoId = getMovieVideoId(titlePage);
  if (!movieVideoId) {
    return null;
  }

  return absolutizeUrl("/watch/" + movieVideoId);
}

async function resolveMirror(url, depth) {
  const currentDepth = depth || 0;
  const normalizedUrl = absolutizeUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  if (isDirectMediaUrl(normalizedUrl)) {
    return normalizedUrl;
  }

  if (currentDepth >= 2) {
    return normalizedUrl;
  }

  try {
    const response = await moflixFetch(normalizedUrl);
    const html = await readResponseText(response);
    const directUrl = extractDirectUrlFromHtml(html);
    if (directUrl) {
      return directUrl;
    }

    const iframeUrl = matchFirst(html, /<iframe[^>]+src="([^"]+)"/i, 1);
    if (iframeUrl) {
      return await resolveMirror(iframeUrl, currentDepth + 1);
    }
  } catch (error) {
    console.log("resolveMirror fallback for " + normalizedUrl + ": " + error.message);
  }

  return normalizedUrl;
}

function collectWatchVideos(watchPage) {
  const combined = [];
  const seen = {};
  const sources = [];

  if (watchPage.video) {
    sources.push(watchPage.video);
  }

  if (Array.isArray(watchPage.alternative_videos)) {
    for (let i = 0; i < watchPage.alternative_videos.length; i += 1) {
      sources.push(watchPage.alternative_videos[i]);
    }
  }

  for (let i = 0; i < sources.length; i += 1) {
    const item = sources[i];
    const src = absolutizeUrl(item && item.src);
    if (!src || seen[src]) {
      continue;
    }

    seen[src] = true;
    combined.push({
      src: src,
      quality: item.quality || "Unknown"
    });
  }

  return combined;
}

function getMovieVideoId(titlePage) {
  if (titlePage.title && titlePage.title.primary_video && titlePage.title.primary_video.id) {
    return titlePage.title.primary_video.id;
  }

  if (Array.isArray(titlePage.title && titlePage.title.videos) && titlePage.title.videos.length) {
    return titlePage.title.videos[0].id;
  }

  return null;
}

function getTitlePage(bootstrapData) {
  return (bootstrapData.loaders && bootstrapData.loaders.titlePage) || {};
}

function getWatchPage(bootstrapData) {
  return (bootstrapData.loaders && bootstrapData.loaders.watchPage) || {};
}

function getSearchPage(bootstrapData) {
  return (bootstrapData.loaders && bootstrapData.loaders.searchPage) || {};
}

function parseBootstrapData(html) {
  const marker = "window.bootstrapData = ";
  const start = html.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const end = html.indexOf("</script>", start);
  if (end === -1) {
    return null;
  }

  let raw = html.slice(start + marker.length, end).trim();
  raw = raw.replace(/;\s*$/, "");

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.log("parseBootstrapData error: " + error.message);
    return null;
  }
}

function extractSearchHrefMap(html) {
  const hrefMap = {};
  const regex = /href="(\/titles\/(\d+)\/[^"]+)"/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const id = match[2];
    if (!id || hrefMap[id]) {
      continue;
    }

    hrefMap[id] = href;
  }

  return hrefMap;
}

function buildTitleHref(item) {
  if (!item || !item.id) {
    return null;
  }

  const slugSource = item.name || item.original_title || "";
  const slug = slugifyTitle(slugSource);
  return "/titles/" + item.id + (slug ? "/" + slug : "");
}

function slugifyTitle(value) {
  return cleanupText(value)
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchHtml(url) {
  const response = await moflixFetch(stripHash(url));
  return await readResponseText(response);
}

async function moflixFetch(
  url,
  options = { headers: {}, method: "GET", body: null }
) {
  const requestOptions = {
    headers: options.headers || {},
    method: options.method || "GET",
    body: options.body || null
  };

  try {
    if (typeof fetch === "function") {
      return await fetch(url, requestOptions);
    }
    if (typeof fetchv2 === "function") {
      return await fetchv2(url, requestOptions);
    }
  } catch (error) {
    console.log("moflixFetch error: " + error.message);
  }

  return null;
}

async function readResponseText(response) {
  if (!response) {
    return "";
  }

  if (typeof response.text === "function") {
    return await response.text();
  }

  if (typeof response.responseText === "string") {
    return response.responseText;
  }

  return String(response);
}

function extractDirectUrlFromHtml(html) {
  const patterns = [
    /https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/i,
    /https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/i,
    /["'](?:file|src|stream|hls|manifest)["']\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /sources?\s*:\s*\[\s*\{\s*(?:file|src)\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const match = html.match(patterns[i]);
    if (!match) {
      continue;
    }

    const candidate = absolutizeUrl(decodeJsString(match[1] || match[0]));
    if (candidate && isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  const packedMatch = String(html || "").match(
    /<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d.*?\))\s*<\/script>/is
  );
  if (packedMatch && packedMatch[1]) {
    try {
      const unpackedScript = unpack(packedMatch[1]);
      for (let i = 0; i < patterns.length; i += 1) {
        const match = unpackedScript.match(patterns[i]);
        if (!match) {
          continue;
        }

        const candidate = absolutizeUrl(decodeJsString(match[1] || match[0]));
        if (candidate && isDirectMediaUrl(candidate)) {
          return candidate;
        }
      }
    } catch (error) {
      console.log("extractDirectUrlFromHtml unpack error: " + error.message);
    }
  }

  return null;
}

function scoreStream(stream) {
  let score = 0;
  const link = String(stream.link || "").toLowerCase();
  const provider = String(stream.provider || "").toLowerCase();

  if (link.indexOf(".m3u8") !== -1) {
    score += 120;
  }

  if (link.indexOf(".mp4") !== -1) {
    score += 110;
  }

  if (!isDirectMediaUrl(link)) {
    score -= 100;
  }

  if (provider.indexOf("veev") !== -1) {
    score += 20;
  } else if (provider.indexOf("vidara") !== -1) {
    score += 15;
  } else if (provider.indexOf("moflix-stream.click") !== -1) {
    score += 80;
  } else if (provider.indexOf("moflix-stream.link") !== -1) {
    score += 75;
  } else if (provider.indexOf("gupload") !== -1) {
    score += 70;
  } else if (provider.indexOf("upns") !== -1) {
    score += 60;
  } else if (provider.indexOf("rpmplay") !== -1) {
    score += 55;
  }

  if (link.indexOf("/watch/") === -1 && link.indexOf("/embed/") === -1 && link.indexOf("/e/") === -1) {
    score += 20;
  }

  return score;
}

function detectProvider(url) {
  const normalizedUrl = String(url || "");
  const match = normalizedUrl.match(/^https?:\/\/([^/]+)/i);
  return match ? match[1].toLowerCase() : "unknown";
}

function isDirectMediaUrl(url) {
  const normalizedUrl = String(url || "").toLowerCase();
  return normalizedUrl.indexOf(".m3u8") !== -1 || normalizedUrl.indexOf(".mp4") !== -1;
}

function extractNames(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(function(item) {
      return cleanupText(item && (item.display_name || item.name));
    })
    .filter(Boolean);
}

function extractCountryNames(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(function(item) {
      return cleanupText(
        item &&
          (item.display_name ||
            item.name ||
            item.country ||
            item.native_name ||
            item.iso)
      );
    })
    .filter(Boolean);
}

function formatRuntime(value) {
  if (value === null || value === undefined || value === "" || value === "Unknown") {
    return "Unknown";
  }

  return String(value) + " min";
}

function extractYear(value) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

function cleanupText(value) {
  return decodeHtml(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, function(_, code) {
      return String.fromCharCode(parseInt(code, 10));
    });
}

function decodeJsString(value) {
  return String(value || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

function stripHash(url) {
  return String(url || "").split("#")[0];
}

function absolutizeUrl(url) {
  const value = String(url || "").trim();
  if (!value) {
    return "";
  }

  if (value.indexOf("http://") === 0 || value.indexOf("https://") === 0) {
    return value;
  }

  if (value.indexOf("//") === 0) {
    return "https:" + value;
  }

  if (value.charAt(0) === "/") {
    return MOFLIX_BASE_URL.replace(/\/+$/, "") + value;
  }

  return MOFLIX_BASE_URL + value.replace(/^\/+/, "");
}

function padNumber(value) {
  const number = toNumber(value);
  return number < 10 ? "0" + number : String(number);
}

function toNumber(value) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
}

function matchFirst(value, regex, groupIndex) {
  const match = String(value || "").match(regex);
  return match ? match[groupIndex || 0] : "";
}

class Unbaser {
  constructor(base) {
    this.ALPHABET = {
      62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      95: "' !\"#$%&\\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'"
    };
    this.dictionary = {};
    this.base = base;

    if (36 < base && base < 62) {
      this.ALPHABET[base] =
        this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
    }

    if (2 <= base && base <= 36) {
      this.unbase = function(value) {
        return parseInt(value, base);
      };
    } else {
      if (!this.ALPHABET[base]) {
        throw new Error("Unsupported base encoding.");
      }

      for (let i = 0; i < this.ALPHABET[base].length; i += 1) {
        this.dictionary[this.ALPHABET[base][i]] = i;
      }

      this.unbase = this._dictunbaser.bind(this);
    }
  }

  _dictunbaser(value) {
    let result = 0;
    const chars = String(value || "").split("").reverse();

    for (let i = 0; i < chars.length; i += 1) {
      result += Math.pow(this.base, i) * this.dictionary[chars[i]];
    }

    return result;
  }
}

function unpack(source) {
  const args =
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/.exec(
      source
    ) ||
    /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/.exec(source);

  if (!args) {
    throw new Error("Could not unpack packed script.");
  }

  const payload = args[1];
  const radix = parseInt(args[2], 10);
  const count = parseInt(args[3], 10);
  const symtab = args[4].split("|");

  if (count !== symtab.length) {
    throw new Error("Malformed p.a.c.k.e.r. symtab.");
  }

  const unbaser = new Unbaser(radix);

  return payload.replace(/\b\w+\b/g, function(word) {
    const index = radix === 1 ? parseInt(word, 10) : unbaser.unbase(word);
    return symtab[index] || word;
  });
}

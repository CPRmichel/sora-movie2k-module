async function searchResults(keyword) {
  try {
    const response = await soraFetch(
      "https://movie2k.cx/search?q=" + encodeURIComponent(keyword)
    );
    const html = await responseText(response);
    const results = [];
    const seen = {};
    const itemRegex =
      /<img src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<a href="(\/stream\/[^"]+)"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/gi;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const image = absolutizeUrl(match[1]);
      const altTitle = cleanupTitle(match[2]);
      const href = absolutizeUrl(match[3]);
      const strongTitle = cleanupTitle(match[4]);
      const title = strongTitle || altTitle;

      if (!title || !href || seen[href]) {
        continue;
      }

      seen[href] = true;
      results.push({
        title: title,
        image: image,
        href: href
      });
    }

    return JSON.stringify(results);
  } catch (error) {
    console.log("searchResults error: " + error.message);
    return JSON.stringify([]);
  }
}

async function extractDetails(url) {
  try {
    const response = await soraFetch(stripHash(url));
    const html = await responseText(response);

    const description = cleanupText(
      matchFirst(
        html,
        /<div class="beschreibung"[^>]*>([\s\S]*?)<\/div>/i,
        1
      )
    ) || "No description available";

    const genres = extractGenres(html);
    const runtime = cleanupText(
      matchFirst(html, /L[aa]nge:\s*([^<|&]+)/i, 1)
    ) || "Unknown";

    const countryYear = cleanupText(
      matchFirst(html, /Land\/Jahr:\s*([^<]+)/i, 1)
    );
    const countryYearParts = countryYear ? countryYear.split("/") : [];
    const country = cleanupText(countryYearParts[0] || "") || "Unknown";
    const year = cleanupText(countryYearParts[countryYearParts.length - 1] || "") || "Unknown";

    const aliases = [
      "Genre: " + (genres.length ? genres.join(", ") : "Unknown"),
      "Runtime: " + runtime,
      "Country: " + country
    ].join(" | ");

    return JSON.stringify([
      {
        description: description,
        aliases: aliases,
        airdate: year
      }
    ]);
  } catch (error) {
    console.log("extractDetails error: " + error.message);
    return JSON.stringify([
      {
        description: "Error loading description",
        aliases: "Genre: Unknown | Runtime: Unknown | Country: Unknown",
        airdate: "Unknown"
      }
    ]);
  }
}

async function extractEpisodes(url) {
  try {
    const cleanUrl = stripHash(url);
    const response = await soraFetch(cleanUrl);
    const html = await responseText(response);

    if (!isSeriesPage(html, cleanUrl)) {
      return JSON.stringify([
        {
          href: cleanUrl,
          number: "Movie"
        }
      ]);
    }

    const seriesBaseUrl = removeQueryParam(cleanUrl, "season");
    const seasonValues = extractSeasonValues(html);
    const seasons = seasonValues.length ? seasonValues : [getQueryParam(cleanUrl, "season") || "1"];
    const episodes = [];

    for (let i = 0; i < seasons.length; i += 1) {
      const season = seasons[i];
      const seasonUrl = setQueryParam(seriesBaseUrl, "season", season);
      const seasonResponse = await soraFetch(seasonUrl);
      const seasonHtml = await responseText(seasonResponse);
      const seasonEpisodes = extractEpisodeOptions(seasonHtml, season, seasonUrl);
      for (let j = 0; j < seasonEpisodes.length; j += 1) {
        episodes.push(seasonEpisodes[j]);
      }
    }

    episodes.sort(function(a, b) {
      if (a._season !== b._season) {
        return a._season - b._season;
      }
      return a._episode - b._episode;
    });

    const finalEpisodes = episodes.map(function(item) {
      return {
        href: item.href,
        number: item.number
      };
    });

    return JSON.stringify(finalEpisodes);
  } catch (error) {
    console.log("extractEpisodes error: " + error.message);
    return JSON.stringify([]);
  }
}

async function extractStreamUrl(url) {
  try {
    const parts = splitHash(url);
    const cleanUrl = parts.base;
    const episodeId = getHashParam(parts.hash, "episodeId");
    const response = await soraFetch(cleanUrl);
    const html = await responseText(response);

    const mirrors = episodeId
      ? extractSeriesMirrors(html, decodeURIComponent(episodeId))
      : extractMovieMirrors(html);

    const resolved = [];
    const seen = {};

    for (let i = 0; i < mirrors.length; i += 1) {
      const mirror = mirrors[i];
      const embedUrl = normalizeMirrorUrl(mirror.url);
      const provider = mirror.provider || detectProvider(embedUrl);
      let streamUrl = await resolveMirror(embedUrl, provider);

      if (!streamUrl) {
        streamUrl = embedUrl;
      }

      if (!streamUrl || seen[streamUrl]) {
        continue;
      }

      seen[streamUrl] = true;
      resolved.push({
        provider: provider,
        quality: mirror.quality || "Unknown",
        link: streamUrl
      });
    }

    if (!resolved.length) {
      return null;
    }

    resolved.sort(function(a, b) {
      return scoreResolvedStream(b) - scoreResolvedStream(a);
    });

    console.log("Selected stream: " + resolved[0].link);
    return resolved[0].link;
  } catch (error) {
    console.log("extractStreamUrl error: " + error.message);
    return null;
  }
}

function scoreResolvedStream(stream) {
  let score = 0;
  const provider = String(stream.provider || "").toLowerCase();
  const link = String(stream.link || "").toLowerCase();

  if (provider.indexOf("vidoza") !== -1) {
    score += 100;
  } else if (provider.indexOf("voe") !== -1) {
    score += 95;
  } else if (provider.indexOf("dood") !== -1) {
    score += 80;
  } else if (provider.indexOf("vidnest") !== -1) {
    score += 70;
  } else if (provider.indexOf("vinovo") !== -1) {
    score += 60;
  }

  if (link.indexOf(".m3u8") !== -1) {
    score += 20;
  }

  if (link.indexOf(".mp4") !== -1) {
    score += 15;
  }

  if (link.indexOf("/e/") === -1 && link.indexOf("/embed-") === -1) {
    score += 10;
  }

  return score;
}

function isSeriesPage(html, url) {
  return (
    html.indexOf('id="series-section" style="display: block;"') !== -1 ||
    html.indexOf('id="season-select"') !== -1 ||
    url.indexOf("type=tv") !== -1
  );
}

function extractSeasonValues(html) {
  const selectHtml = matchFirst(
    html,
    /<select id="season-select"[\s\S]*?<\/select>/i,
    0
  );

  if (!selectHtml) {
    return [];
  }

  const seasons = [];
  const seasonRegex = /<option value="([^"]+)"[^>]*>/gi;
  let match;

  while ((match = seasonRegex.exec(selectHtml)) !== null) {
    const value = cleanupText(match[1]);
    if (value && seasons.indexOf(value) === -1) {
      seasons.push(value);
    }
  }

  return seasons;
}

function extractEpisodeOptions(html, season, seasonUrl) {
  const selectHtml = matchFirst(
    html,
    /<select id="episode-select"[\s\S]*?<\/select>/i,
    0
  );

  if (!selectHtml) {
    return [];
  }

  const episodes = [];
  const optionRegex =
    /<option value="([^"]+)"[^>]*data-name="([^"]*)"[^>]*data-overview="([^"]*)"[^>]*>([^<]+)<\/option>/gi;
  let match;

  while ((match = optionRegex.exec(selectHtml)) !== null) {
    const episodeId = cleanupText(match[1]);
    const optionLabel = cleanupText(match[4]);
    const episodeMatch = optionLabel.match(/E(\d+)/i);
    const episodeNumber = episodeMatch ? parseInt(episodeMatch[1], 10) : episodes.length + 1;
    const seasonNumber = parseInt(season, 10) || 1;

    episodes.push({
      href: setHashParam(seasonUrl, "episodeId", encodeURIComponent(episodeId)),
      number: "S" + seasonNumber + "E" + episodeNumber,
      _season: seasonNumber,
      _episode: episodeNumber
    });
  }

  return episodes;
}

function getBaseFromHtml(html) {
  const canonical = matchFirst(html, /<link rel="canonical" href="([^"]+)"/i, 1);
  return canonical ? absolutizeUrl(canonical) : "";
}

function extractMovieMirrors(html) {
  const section = matchFirst(
    html,
    /<div id="movie-quality-section"[\s\S]*?<\/div>\s*<\/div>/i,
    0
  ) || html;
  const mirrors = [];
  const mirrorRegex =
    /<a href="(https:\/\/[^"]+)" onclick="return loadMirror\('https:\/\/[^']+'\)">[\s\S]*?&nbsp;\s*([a-z0-9.-]+)[\s\S]*?(?:alt="([^"]+)")?/gi;
  let match;

  while ((match = mirrorRegex.exec(section)) !== null) {
    mirrors.push({
      url: match[1],
      provider: cleanupText(match[2]).toLowerCase(),
      quality: cleanupText(match[3] || "Unknown")
    });
  }

  return mirrors;
}

function extractSeriesMirrors(html, episodeId) {
  const rowRegex = new RegExp(
    '<table[^>]*data-episode-id="' + escapeRegex(episodeId) + '"[\\s\\S]*?<\\/table>',
    "i"
  );
  const rowHtml = matchFirst(html, rowRegex, 0);
  if (!rowHtml) {
    return [];
  }

  const mirrors = [];
  const mirrorRegex =
    /loadMirror\('([^']+)'\)" data-host="([^"]+)"[\s\S]*?(?:alt="([^"]+)")?/gi;
  let match;

  while ((match = mirrorRegex.exec(rowHtml)) !== null) {
    mirrors.push({
      url: match[1],
      provider: cleanupText(match[2]).toLowerCase(),
      quality: cleanupText(match[3] || "Unknown")
    });
  }

  return mirrors;
}

async function resolveMirror(url, provider) {
  try {
    const normalizedUrl = normalizeMirrorUrl(url);
    const detectedProvider = (provider || detectProvider(normalizedUrl)).toLowerCase();

    if (detectedProvider.indexOf("voe") !== -1) {
      return await resolveVoe(normalizedUrl);
    }

    if (detectedProvider.indexOf("vidoza") !== -1) {
      const html = await fetchText(normalizedUrl);
      return vidozaExtractor(html, normalizedUrl) || extractFirstMediaUrl(html);
    }

    if (detectedProvider.indexOf("dood") !== -1) {
      const html = await fetchText(normalizedUrl);
      return await doodstreamExtractor(html, normalizedUrl);
    }

    if (detectedProvider.indexOf("vinovo") !== -1) {
      const html = await fetchText(normalizedUrl);
      return (
        await vinovoExtractor(html, normalizedUrl)
      ) || extractFirstMediaUrl(html);
    }

    const genericHtml = await fetchText(normalizedUrl);
    return extractFirstMediaUrl(genericHtml);
  } catch (error) {
    console.log("resolveMirror error: " + error.message);
    return null;
  }
}

async function resolveVoe(url) {
  let html = await fetchText(url);
  const redirect = matchFirst(
    html,
    /window\.location\.href\s*=\s*['"]([^'"]+)['"]/i,
    1
  );

  if (redirect) {
    html = await fetchText(redirect);
  }

  return voeExtractor(html, url) || extractFirstMediaUrl(html);
}

async function vinovoExtractor(html, url) {
  try {
    const fileCode = matchFirst(
      html,
      /<meta name="file_code" content="([^"]+)"/i,
      1
    );
    const token = matchFirst(
      html,
      /<meta name="token" content="([^"]+)"/i,
      1
    );

    if (!fileCode || !token) {
      return null;
    }

    const headers = {
      "X-Requested-With": "XMLHttpRequest",
      "Referer": url,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    };
    const body = "token=" + encodeURIComponent(token) + "&referrer=";

    try {
      await soraFetch("https://vinovo.to/api/file/ping/" + fileCode, {
        headers: headers,
        method: "POST",
        body: body
      });
    } catch (error) {
      console.log("vinovo ping failed: " + error.message);
    }

    const response = await soraFetch("https://vinovo.to/api/file/url/" + fileCode, {
      headers: headers,
      method: "POST",
      body: body
    });
    const text = await responseText(response);
    const data = safeJsonParse(text);

    if (data) {
      if (typeof data.result === "string" && data.result.indexOf("http") === 0) {
        return data.result;
      }
      if (typeof data.url === "string" && data.url.indexOf("http") === 0) {
        return data.url;
      }
      if (data.result && typeof data.result.url === "string") {
        return data.result.url;
      }
      if (data.data && typeof data.data.url === "string") {
        return data.data.url;
      }
    }

    return extractFirstMediaUrl(text);
  } catch (error) {
    console.log("vinovoExtractor error: " + error.message);
    return null;
  }
}

async function doodstreamExtractor(html, url) {
  try {
    const domainMatch = url.match(/^https:\/\/([^/]+)/i);
    const md5PathMatch = html.match(/['"]\/pass_md5\/([^'"]+)['"]/i);

    if (!domainMatch || !md5PathMatch) {
      return extractFirstMediaUrl(html);
    }

    const domain = domainMatch[1];
    const md5Path = md5PathMatch[1];
    const token = md5Path.substring(md5Path.lastIndexOf("/") + 1);
    const passResponse = await soraFetch("https://" + domain + "/pass_md5/" + md5Path, {
      headers: {
        "Referer": url
      }
    });
    const passText = await responseText(passResponse);
    const random = randomString(10);

    return passText + random + "?token=" + token + "&expiry=" + new Date().valueOf();
  } catch (error) {
    console.log("doodstreamExtractor error: " + error.message);
    return null;
  }
}

function vidozaExtractor(html) {
  return (
    matchFirst(html, /<source src="([^"]+)" type=['"]video\/mp4['"]>/i, 1) ||
    matchFirst(html, /sourcesCode:\s*\[\{\s*src:\s*"([^"]+)"/i, 1)
  );
}

function voeExtractor(html) {
  const jsonScriptMatch = html.match(
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (!jsonScriptMatch) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(jsonScriptMatch[1].trim());
  } catch (error) {
    return null;
  }

  if (!Array.isArray(data) || typeof data[0] !== "string") {
    return null;
  }

  let decoded = voeRot13(data[0]);
  decoded = voeRemovePatterns(decoded);
  decoded = safeAtob(decoded);
  if (!decoded) {
    return null;
  }

  decoded = voeShiftChars(decoded, 3);
  decoded = decoded.split("").reverse().join("");
  decoded = safeAtob(decoded);
  if (!decoded) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch (error) {
    return null;
  }

  if (parsed && typeof parsed.direct_access_url === "string") {
    return parsed.direct_access_url;
  }

  if (parsed && Array.isArray(parsed.source)) {
    for (let i = 0; i < parsed.source.length; i += 1) {
      if (
        parsed.source[i] &&
        typeof parsed.source[i].direct_access_url === "string" &&
        parsed.source[i].direct_access_url.indexOf("http") === 0
      ) {
        return parsed.source[i].direct_access_url;
      }
    }
  }

  return null;
}

function extractGenres(html) {
  const detailsBlock = matchFirst(
    html,
    /Genre:\s*([\s\S]*?)(?:&nbsp;\||<\/div>)/i,
    1
  );

  if (!detailsBlock) {
    return [];
  }

  const genres = [];
  const genreRegex = />([^<]+)<\/a>/gi;
  let match;

  while ((match = genreRegex.exec(detailsBlock)) !== null) {
    const genre = cleanupText(match[1]);
    if (genre && genres.indexOf(genre) === -1) {
      genres.push(genre);
    }
  }

  return genres;
}

function extractFirstMediaUrl(html) {
  const patterns = [
    /<source[^>]+src="([^"]+\.(?:mp4|m3u8)[^"]*)"/i,
    /sources:\s*\[\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i,
    /sourcesCode:\s*\[\{\s*src:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i,
    /file:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i,
    /var source='([^']+\.(?:mp4|m3u8)[^']*)'/i,
    /"direct_access_url":"([^"]+)"/i,
    /(https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*)/i,
    /(https?:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*)/i
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const match = html.match(patterns[i]);
    if (match && match[1]) {
      return decodeHtml(match[1]);
    }
  }

  return null;
}

function normalizeMirrorUrl(url) {
  let normalized = url;

  if (normalized.indexOf("vidoza.net/") !== -1 && normalized.indexOf("/embed-") === -1) {
    normalized = normalized.replace(/vidoza\.net\/([a-z0-9]+\.html)/i, "vidoza.net/embed-$1");
  }

  if (normalized.indexOf("voe.sx/") !== -1 && normalized.indexOf("/e/") === -1) {
    normalized = normalized.replace(/voe\.sx\/([a-z0-9-]+)/i, "voe.sx/e/$1");
  }

  if (normalized.indexOf("doodstream.com/d/") !== -1) {
    normalized = normalized.replace("doodstream.com/d/", "doodstream.com/e/");
  }

  if (normalized.indexOf("vinovo.to/d/") !== -1) {
    normalized = normalized.replace("vinovo.to/d/", "vinovo.to/e/");
  }

  return normalized;
}

function detectProvider(url) {
  const hostMatch = url.match(/^https?:\/\/([^/]+)/i);
  return hostMatch ? hostMatch[1].toLowerCase() : "unknown";
}

function cleanupTitle(value) {
  return cleanupText(value).replace(/:$/, "");
}

function cleanupText(value) {
  return collapseWhitespace(stripTags(decodeHtml(value || "")));
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  let text = String(value || "");
  const entities = {
    "&amp;": "&",
    "&quot;": "\"",
    "&#34;": "\"",
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " "
  };

  for (const key in entities) {
    if (Object.prototype.hasOwnProperty.call(entities, key)) {
      text = text.split(key).join(entities[key]);
    }
  }

  text = text.replace(/&#(\d+);/g, function(_, code) {
    return String.fromCharCode(parseInt(code, 10));
  });

  text = text.replace(/&#x([0-9a-f]+);/gi, function(_, code) {
    return String.fromCharCode(parseInt(code, 16));
  });

  return text;
}

function matchFirst(input, regex, groupIndex) {
  const match = input.match(regex);
  return match ? match[groupIndex] : "";
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitHash(url) {
  const index = url.indexOf("#");
  if (index === -1) {
    return { base: url, hash: "" };
  }
  return {
    base: url.slice(0, index),
    hash: url.slice(index + 1)
  };
}

function stripHash(url) {
  return splitHash(url).base;
}

function getHashParam(hash, key) {
  const params = parseQueryString(hash);
  return params[key] || "";
}

function setHashParam(url, key, value) {
  const parts = splitHash(url);
  const params = parseQueryString(parts.hash);
  params[key] = value;
  return parts.base + "#" + buildQueryString(params);
}

function getQueryParam(url, key) {
  const parts = splitUrl(url);
  const params = parseQueryString(parts.query);
  return params[key] || "";
}

function setQueryParam(url, key, value) {
  const parts = splitUrl(url);
  const params = parseQueryString(parts.query);
  params[key] = value;
  const query = buildQueryString(params);
  return parts.base + (query ? "?" + query : "");
}

function removeQueryParam(url, key) {
  const parts = splitUrl(url);
  const params = parseQueryString(parts.query);
  delete params[key];
  const query = buildQueryString(params);
  return parts.base + (query ? "?" + query : "");
}

function splitUrl(url) {
  const hashless = stripHash(url);
  const index = hashless.indexOf("?");
  if (index === -1) {
    return { base: hashless, query: "" };
  }
  return {
    base: hashless.slice(0, index),
    query: hashless.slice(index + 1)
  };
}

function parseQueryString(query) {
  const result = {};
  if (!query) {
    return result;
  }

  const parts = query.split("&");
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i]) {
      continue;
    }
    const pair = parts[i].split("=");
    const key = pair[0];
    const value = pair.length > 1 ? pair.slice(1).join("=") : "";
    result[key] = value;
  }

  return result;
}

function buildQueryString(params) {
  const parts = [];
  for (const key in params) {
    if (
      Object.prototype.hasOwnProperty.call(params, key) &&
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ""
    ) {
      parts.push(key + "=" + params[key]);
    }
  }
  return parts.join("&");
}

function absolutizeUrl(url) {
  if (!url) {
    return "";
  }
  if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) {
    return url;
  }
  if (url.indexOf("//") === 0) {
    return "https:" + url;
  }
  if (url.charAt(0) === "/") {
    return "https://movie2k.cx" + url;
  }
  return "https://movie2k.cx/" + url;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function safeAtob(value) {
  try {
    return atob(value);
  } catch (error) {
    return null;
  }
}

function voeRot13(str) {
  return str.replace(/[a-zA-Z]/g, function(char) {
    return String.fromCharCode(
      (char <= "Z" ? 90 : 122) >= (char = char.charCodeAt(0) + 13)
        ? char
        : char - 26
    );
  });
}

function voeRemovePatterns(str) {
  const patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
  let result = str;
  for (let i = 0; i < patterns.length; i += 1) {
    result = result.split(patterns[i]).join("");
  }
  return result;
}

function voeShiftChars(str, shift) {
  return str
    .split("")
    .map(function(char) {
      return String.fromCharCode(char.charCodeAt(0) - shift);
    })
    .join("");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

async function fetchText(url, headers) {
  const response = await soraFetch(url, {
    headers: headers || {},
    method: "GET",
    body: null
  });
  return responseText(response);
}

async function responseText(response) {
  if (!response) {
    return "";
  }

  if (typeof response.text === "function") {
    return await response.text();
  }

  return typeof response === "string" ? response : "";
}

async function soraFetch(
  url,
  options = { headers: {}, method: "GET", body: null }
) {
  try {
    return await fetchv2(
      url,
      options.headers || {},
      options.method || "GET",
      options.body || null
    );
  } catch (error) {
    try {
      return await fetch(url, options);
    } catch (fallbackError) {
      console.log("soraFetch error: " + fallbackError.message);
      return null;
    }
  }
}

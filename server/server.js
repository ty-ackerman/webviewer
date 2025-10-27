const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const https = require("https");
const http = require("http");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 3000;
const STORE_PATH = process.env.STORE_PATH
  ? path.resolve(process.env.STORE_PATH)
  : path.join(__dirname, "streamStore.json");

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "../public")));

// helper: normalize persisted data shape
function ensureStoreShape(raw) {
  const base = {
    videos: [],
    currentVideoId: null,
    streams: [],
    currentStreamId: null
  };

  if (!raw || typeof raw !== "object") {
    return base;
  }

  const data = { ...base };

  if (Array.isArray(raw.videos)) {
    data.videos = raw.videos;
  }

  if (typeof raw.currentVideoId === "string" || raw.currentVideoId === null) {
    data.currentVideoId = raw.currentVideoId;
  }

  if (Array.isArray(raw.streams)) {
    data.streams = raw.streams
      .map(normalizeStreamEntry)
      .filter(Boolean);
  }

  if (typeof raw.currentStreamId === "string" || raw.currentStreamId === null) {
    data.currentStreamId = raw.currentStreamId;
  }

  if (data.currentStreamId && !data.streams.find(s => s.id === data.currentStreamId)) {
    data.currentStreamId = data.streams[0]?.id || null;
  }

  return data;
}

// helper: read persisted data
function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return ensureStoreShape(JSON.parse(raw));
  } catch (e) {
    return ensureStoreShape();
  }
}

// helper: write persisted data
function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const normalized = ensureStoreShape(data);
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalized, null, 2), "utf8");
}

// cheap id generator for list items
function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function extractEmbedSrc(embedCode) {
  if (typeof embedCode !== "string") return "";
  const match = embedCode.match(/src=["']([^"']+)["']/i);
  return match && match[1] ? match[1] : "";
}

function guessStreamTitle({ providedTitle, embedCode }) {
  if (providedTitle && typeof providedTitle === "string" && providedTitle.trim()) {
    return providedTitle.trim();
  }

  const src = extractEmbedSrc(embedCode);
  if (!src) {
    return "Custom Stream";
  }

  try {
    const parsed = new URL(src, "https://placeholder.local");
    const host = parsed.hostname.replace(/^www\./i, "");
    const pathPart = parsed.pathname.replace(/^\/+/, "");
    if (pathPart) {
      return `${host} / ${pathPart}`;
    }
    return host || "Custom Stream";
  } catch (err) {
    return "Custom Stream";
  }
}

function normalizeStreamEntry(stream) {
  if (!stream || typeof stream !== "object") return null;

  const id = typeof stream.id === "string" ? stream.id : null;
  if (!id) return null;

  const embedCode = typeof stream.embedCode === "string" ? stream.embedCode : "";
  const embedSrcRaw = typeof stream.embedSrc === "string" ? stream.embedSrc.trim() : "";
  const resolvedEmbedSrc = embedSrcRaw || extractEmbedSrc(embedCode) || null;
  const sourceUrl = typeof stream.sourceUrl === "string" ? stream.sourceUrl.trim() : null;
  const network = typeof stream.network === "string" ? stream.network.trim() : "";
  const viewersValue = stream.viewers;
  let viewers = null;
  if (typeof viewersValue === "number" && Number.isFinite(viewersValue)) {
    viewers = viewersValue;
  } else if (typeof viewersValue === "string") {
    const parsed = parseInt(viewersValue.replace(/[^0-9]/g, ""), 10);
    viewers = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    id,
    title:
      typeof stream.title === "string" && stream.title.trim()
        ? stream.title
        : guessStreamTitle({ providedTitle: "", embedCode }),
    embedCode,
    embedSrc: resolvedEmbedSrc,
    sandboxed: stream.sandboxed !== false,
    sourceUrl,
    network,
    viewers
  };
}

function decodeHtmlEntities(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function fetchRemoteDocument(targetUrl, { maxRedirects = 4, timeout = 10000 } = {}) {
  const visited = [];

  return new Promise((resolve, reject) => {
    function load(urlString, redirectsRemaining) {
      let urlObj;
      try {
        urlObj = new URL(urlString);
      } catch (err) {
        return reject(new Error("Invalid URL."));
      }

      const lib = urlObj.protocol === "https:" ? https : http;
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br"
        }
      };

      console.log("[fetch]", options.method, urlObj.toString());

      const req = lib.request(options, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsRemaining <= 0) {
            res.resume();
            return reject(new Error("Too many redirects"));
          }
          const nextUrl = new URL(res.headers.location, urlObj).toString();
          visited.push(urlObj.toString());
          res.resume();
          return load(nextUrl, redirectsRemaining - 1);
        }

        if (res.statusCode !== 200) {
          console.warn("[fetch] Non-200 status", res.statusCode, "for", urlObj.toString());
          res.resume();
          return reject(new Error(`Remote responded with status ${res.statusCode}`));
        }

        const chunks = [];
        let totalLength = 0;
        res.on("data", chunk => {
          chunks.push(chunk);
          totalLength += chunk.length;
          if (totalLength > 2_000_000) {
            req.destroy(new Error("Document too large"));
          }
        });
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const encoding = (res.headers["content-encoding"] || "").toLowerCase();
          let decodedBuffer = buffer;

          try {
            if (encoding.includes("br")) {
              decodedBuffer = zlib.brotliDecompressSync(buffer);
            } else if (encoding.includes("gzip")) {
              decodedBuffer = zlib.gunzipSync(buffer);
            } else if (encoding.includes("deflate")) {
              decodedBuffer = zlib.inflateSync(buffer);
            }
          } catch (err) {
            console.warn("Failed to decompress response", err.message);
            decodedBuffer = buffer;
          }

          resolve(decodedBuffer.toString("utf8"));
        });
      });

      req.on("error", err => {
        console.error("[fetch] Request error", urlObj.toString(), err.message || err);
        reject(err);
      });

      req.setTimeout(timeout, () => {
        req.destroy(new Error("Request timed out"));
      });

      req.end();
    }

    load(targetUrl, maxRedirects);
  });
}

function extractEmbedFromHtml(html) {
  if (typeof html !== "string" || !html.trim()) {
    return { embedCode: "", title: "" };
  }

  const textareaMatch = html.match(/<textarea[^>]*id=["']embedcode["'][^>]*>([\s\S]*?)<\/textarea>/i);
  let embedCode = textareaMatch ? textareaMatch[1].trim() : "";
  embedCode = decodeHtmlEntities(embedCode);

  if (!embedCode) {
    const iframeMatch = html.match(/<iframe[^>]+src=["'][^"']+["'][^>]*><\/iframe>/i);
    embedCode = iframeMatch ? decodeHtmlEntities(iframeMatch[0]) : "";
  }

  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  let title = ogTitleMatch ? ogTitleMatch[1] : "";

  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = titleMatch ? titleMatch[1] : "";
  }

  return {
    embedCode: embedCode.trim(),
    title: decodeHtmlEntities(title).trim()
  };
}

function compactWhitespace(str) {
  return typeof str === "string" ? str.replace(/\s+/g, " ").trim() : "";
}

async function fetchLiveNowStreams({ limit = Infinity } = {}) {
  const baseUrl = "https://ppv.to/";
  console.log("[live-scraper] Fetching homepage", baseUrl);
  const homepageHtml = await fetchRemoteDocument(baseUrl);

  const anchors = Array.from(
    homepageHtml.matchAll(
      /<a[^>]+class=["'][^"']*item-card[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    )
  );

  console.log("[live-scraper] Found", anchors.length, "item-card anchors");

  if (!anchors.length) {
    const sample = homepageHtml.slice(0, 400).replace(/\s+/g, " ");
    console.warn("[live-scraper] No anchors matched. Document sample:", sample);
    return {
      results: [],
      failures: [
        {
          sourceUrl: baseUrl,
          reason: "no_live_cards",
          sample
        }
      ]
    };
  }

  const max = Number.isFinite(limit) ? limit : anchors.length;
  const cards = anchors.slice(0, max).map((match, idx) => {
    const href = match[1];
    const snippet = match[2] || "";
    const cardTitleMatch = snippet.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
    const cardTitle = decodeHtmlEntities(cardTitleMatch ? cardTitleMatch[1] : "");
    const networkMatch = snippet.match(
      /<span[^>]*class=["'][^"']*text-muted[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    );
    const network = decodeHtmlEntities(networkMatch ? networkMatch[1] : "");
    const viewersMatch = snippet.match(
      /<span[^>]*class=["'][^"']*float-end[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    );
    const viewersText = decodeHtmlEntities(viewersMatch ? viewersMatch[1] : "");
    const viewersNumeric = viewersText.replace(/[^0-9]/g, "");
    const viewers = viewersNumeric ? parseInt(viewersNumeric, 10) : null;

    const absoluteUrl = new URL(href, baseUrl).toString();

    const card = {
      sourceUrl: absoluteUrl,
      cardTitle: compactWhitespace(cardTitle),
      network: compactWhitespace(network),
      viewers: Number.isFinite(viewers) ? viewers : null
    };
    if (idx < 5) {
      console.log("[live-scraper] Card", idx + 1, card);
    }
    return card;
  });

  const results = [];
  const failures = [];

  for (const card of cards) {
    try {
      console.log("[live-scraper] Fetching stream page", card.sourceUrl);
      const streamHtml = await fetchRemoteDocument(card.sourceUrl);
      const { embedCode, title } = extractEmbedFromHtml(streamHtml);
      if (!embedCode) {
        console.warn("[live-scraper] No embed found for", card.sourceUrl);
        failures.push({ sourceUrl: card.sourceUrl, reason: "embed_not_found" });
        continue;
      }

      results.push({
        id: makeId(),
        title: compactWhitespace(title) || card.cardTitle || "PPV Stream",
        embedCode,
        embedSrc: extractEmbedSrc(embedCode),
        sandboxed: true,
        sourceUrl: card.sourceUrl,
        network: card.network,
        viewers: card.viewers
      });
    } catch (err) {
      console.error("[live-scraper] Failed stream page", card.sourceUrl, err);
      failures.push({ sourceUrl: card.sourceUrl, reason: err.message || "fetch_failed" });
    }
  }

  console.log("[live-scraper] Completed import. Success:", results.length, "Failures:", failures.length);

  return { results, failures };
}

// fetch a friendly title from YouTube's oEmbed endpoint
function fetchYouTubeTitle(ytId) {
  if (!ytId) return Promise.resolve("");

  const oembedUrl = `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${ytId}`;

  return new Promise(resolve => {
    https
      .get(oembedUrl, res => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve("");
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve(typeof parsed.title === "string" ? parsed.title : "");
          } catch {
            resolve("");
          }
        });
      })
      .on("error", () => resolve(""));
  });
}

// extract the YouTube video ID so we can embed it properly
// Accepts formats like:
//  https://www.youtube.com/watch?v=VIDEOID
//  https://youtu.be/VIDEOID
//  https://www.youtube.com/embed/VIDEOID
function extractYouTubeId(rawUrl) {
  if (typeof rawUrl !== "string") return "";

  // Try common patterns
  // 1) watch?v=VIDEOID
  let match = rawUrl.match(/[?&]v=([^&?#]+)/i);
  if (match && match[1]) return match[1];

  // 2) youtu.be/VIDEOID
  match = rawUrl.match(/youtu\.be\/([^?&#/]+)/i);
  if (match && match[1]) return match[1];

  // 3) /embed/VIDEOID
  match = rawUrl.match(/youtube\.com\/embed\/([^?&#/]+)/i);
  if (match && match[1]) return match[1];

  return "";
}

// GET list of videos + which one is currently selected
app.get("/api/videos", (req, res) => {
  const data = readStore();
  res.json({
    videos: data.videos,
    currentVideoId: data.currentVideoId
  });
});

// POST new video
// body: { url: "https://www.youtube.com/watch?v=..." }
app.post("/api/videos", async (req, res) => {
  const { title, url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: "Missing url" });
  }

  const ytId = extractYouTubeId(url);
  if (!ytId) {
    return res.status(400).json({ error: "Could not parse YouTube ID from URL" });
  }

  try {
    const data = readStore();

    const fetchedTitle = await fetchYouTubeTitle(ytId);
    const resolvedTitle =
      (typeof title === "string" && title.trim()) ||
      fetchedTitle ||
      `YouTube Video (${ytId})`;

    const newVid = {
      id: makeId(),
      title: resolvedTitle,
      url: url.trim(),        // original link you pasted
      ytId: ytId.trim()       // parsed ID we embed
    };

    data.videos.push(newVid);

    // If nothing currently selected, select this one
    if (!data.currentVideoId) {
      data.currentVideoId = newVid.id;
    }

    writeStore(data);

    res.json({ ok: true, video: newVid });
  } catch (err) {
    console.error("Failed to add video", err);
    res.status(500).json({ error: "Server error while adding video." });
  }
});

// POST select current video
// body: { id: "abc123" }
app.post("/api/select", (req, res) => {
  const { id } = req.body;

  const data = readStore();
  const exists = data.videos.find(v => v.id === id);

  if (!exists) {
    return res.status(404).json({ error: "Video not found" });
  }

  data.currentVideoId = id;
  writeStore(data);

  res.json({ ok: true, currentVideoId: id });
});

// DELETE a video by id
app.delete("/api/videos/:id", (req, res) => {
  const { id } = req.params;

  const data = readStore();
  const beforeLen = data.videos.length;
  data.videos = data.videos.filter(v => v.id !== id);

  // If we deleted the current video, unset or switch to first left
  if (data.currentVideoId === id) {
    data.currentVideoId = data.videos[0]?.id || null;
  }

  writeStore(data);

  res.json({
    ok: true,
    removed: beforeLen !== data.videos.length
  });
});

// Viewer helper: get the currently selected video (resolved)
app.get("/api/current", (req, res) => {
  const data = readStore();
  const current = data.videos.find(v => v.id === data.currentVideoId) || null;
  res.json({
    currentVideo: current
      ? {
          id: current.id,
          title: current.title,
          ytId: current.ytId,
          embedUrl: `https://www.youtube.com/embed/${current.ytId}`
        }
      : null
  });
});

// Streams APIs
app.get("/api/streams", (req, res) => {
  const data = readStore();
  res.json({
    streams: data.streams,
    currentStreamId: data.currentStreamId
  });
});

app.post("/api/streams", (req, res) => {
  const { title, embedCode, sandboxed } = req.body || {};

  if (!embedCode || typeof embedCode !== "string" || !embedCode.trim()) {
    return res.status(400).json({ error: "Missing embedCode" });
  }

  try {
    const data = readStore();
    const trimmedEmbed = embedCode.trim();
    const embedSrc = extractEmbedSrc(trimmedEmbed);
    const resolvedTitle = guessStreamTitle({ providedTitle: title, embedCode: trimmedEmbed });

    const newStream = normalizeStreamEntry({
      id: makeId(),
      title: resolvedTitle,
      embedCode: trimmedEmbed,
      embedSrc: embedSrc || null,
      sandboxed: sandboxed !== false
    });

    if (!newStream) {
      return res.status(500).json({ error: "Failed to normalize stream." });
    }

    data.streams.push(newStream);

    if (!data.currentStreamId) {
      data.currentStreamId = newStream.id;
    }

    writeStore(data);

    res.json({ ok: true, stream: newStream });
  } catch (err) {
    console.error("Failed to add stream", err);
    res.status(500).json({ error: "Server error while adding stream." });
  }
});

app.post("/api/streams/select", (req, res) => {
  const { id } = req.body || {};

  const data = readStore();
  const exists = data.streams.find(s => s.id === id);

  if (!exists) {
    return res.status(404).json({ error: "Stream not found" });
  }

  data.currentStreamId = id;
  writeStore(data);

  res.json({ ok: true, currentStreamId: id });
});

app.delete("/api/streams/:id", (req, res) => {
  const { id } = req.params;

  const data = readStore();
  const beforeLen = data.streams.length;
  data.streams = data.streams.filter(s => s.id !== id);

  if (data.currentStreamId === id) {
    data.currentStreamId = data.streams[0]?.id || null;
  }

  writeStore(data);

  res.json({
    ok: true,
    removed: beforeLen !== data.streams.length
  });
});

app.get("/api/streams/current", (req, res) => {
  const data = readStore();
  const current = data.streams.find(s => s.id === data.currentStreamId) || null;
  res.json({ currentStream: current });
});

app.patch("/api/streams/:id", (req, res) => {
  const { id } = req.params;
  const { sandboxed } = req.body || {};

  const data = readStore();
  const stream = data.streams.find(s => s.id === id);

  if (!stream) {
    return res.status(404).json({ error: "Stream not found" });
  }

  let mutated = false;

  if (typeof sandboxed === "boolean") {
    stream.sandboxed = sandboxed;
    mutated = true;
  }

  if (!mutated) {
    return res.status(400).json({ error: "No updates provided" });
  }

  writeStore(data);

  res.json({ ok: true, stream });
});

app.post("/api/streams/extract", async (req, res) => {
  const { url } = req.body || {};

  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "Missing url" });
  }

  let normalizedUrl;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).json({ error: "URL must be http or https." });
    }
    normalizedUrl = parsed.toString();
  } catch (err) {
    return res.status(400).json({ error: "Invalid URL." });
  }

  try {
    const html = await fetchRemoteDocument(normalizedUrl);
    const { embedCode, title } = extractEmbedFromHtml(html);

    if (!embedCode) {
      return res.status(404).json({ error: "Embed code not found on that page." });
    }

    res.json({ ok: true, embedCode, title });
  } catch (err) {
    console.error("Failed to extract embed from", normalizedUrl, err);
    res.status(500).json({ error: "Failed to fetch embed code." });
  }
});

app.post("/api/streams/import-live-now", async (req, res) => {
  try {
    const { results: discovered, failures } = await fetchLiveNowStreams();

    const data = readStore();
    const added = [];
    const skipped = [];

    discovered.forEach(candidate => {
      const normalized = normalizeStreamEntry(candidate);
      if (!normalized) {
        return;
      }

      const duplicate = data.streams.find(existing => {
        if (normalized.embedSrc && existing.embedSrc) {
          return existing.embedSrc === normalized.embedSrc;
        }
        if (normalized.embedCode && existing.embedCode) {
          return existing.embedCode === normalized.embedCode;
        }
        if (normalized.sourceUrl && existing.sourceUrl) {
          return existing.sourceUrl === normalized.sourceUrl;
        }
        return false;
      });

      if (duplicate) {
        skipped.push({ id: duplicate.id, sourceUrl: normalized.sourceUrl });
        return;
      }

      data.streams.push(normalized);
      added.push(normalized);
    });

    if (!data.currentStreamId && added.length) {
      data.currentStreamId = added[0].id;
    }

    if (added.length) {
      writeStore(data);
    }

    res.json({
      ok: true,
      addedCount: added.length,
      added,
      skippedCount: skipped.length,
      skipped,
      failures
    });
  } catch (err) {
    console.error("Failed to import live streams", err);
    res.status(500).json({ error: "Failed to import live streams.", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

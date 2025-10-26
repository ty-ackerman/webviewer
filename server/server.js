const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const https = require("https");

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

  return {
    id,
    title:
      typeof stream.title === "string" && stream.title.trim()
        ? stream.title
        : guessStreamTitle({ providedTitle: "", embedCode }),
    embedCode,
    embedSrc: resolvedEmbedSrc,
    sandboxed: stream.sandboxed !== false
  };
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

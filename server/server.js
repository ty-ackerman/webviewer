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

// helper: read persisted data
function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {
      videos: [], // [{ id: "abc123", title: "Raptors Highlights", url: "https://www.youtube.com/watch?v=..." }]
      currentVideoId: null
    };
  }
}

// helper: write persisted data
function writeStore(data) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

// cheap id generator for list items
function makeId() {
  return Math.random().toString(36).slice(2, 9);
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

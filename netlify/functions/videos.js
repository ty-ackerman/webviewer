const https = require("https");
const { readStore, writeStore, makeId } = require("./lib/store");

// Extract YouTube video ID from URL
function extractYouTubeId(rawUrl) {
  if (typeof rawUrl !== "string") return "";

  let match = rawUrl.match(/[?&]v=([^&?#]+)/i);
  if (match && match[1]) return match[1];

  match = rawUrl.match(/youtu\.be\/([^?&#/]+)/i);
  if (match && match[1]) return match[1];

  match = rawUrl.match(/youtube\.com\/embed\/([^?&#/]+)/i);
  if (match && match[1]) return match[1];

  return "";
}

// Fetch YouTube title from oEmbed
function fetchYouTubeTitle(ytId) {
  if (!ytId) return Promise.resolve("");

  const oembedUrl = `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${ytId}`;

  return new Promise((resolve) => {
    https
      .get(oembedUrl, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve("");
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
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

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    // GET /api/videos - list videos
    if (event.httpMethod === "GET") {
      const data = await readStore();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          videos: data.videos,
          currentVideoId: data.currentVideoId,
        }),
      };
    }

    // POST /api/videos - add new video
    if (event.httpMethod === "POST") {
      const { title, url } = JSON.parse(event.body || "{}");

      if (!url) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing url" }),
        };
      }

      const ytId = extractYouTubeId(url);
      if (!ytId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Could not parse YouTube ID from URL" }),
        };
      }

      const data = await readStore();

      const fetchedTitle = await fetchYouTubeTitle(ytId);
      const resolvedTitle =
        (typeof title === "string" && title.trim()) ||
        fetchedTitle ||
        `YouTube Video (${ytId})`;

      const newVid = {
        id: makeId(),
        title: resolvedTitle,
        url: url.trim(),
        ytId: ytId.trim(),
      };

      data.videos.push(newVid);

      if (!data.currentVideoId) {
        data.currentVideoId = newVid.id;
      }

      await writeStore(data);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, video: newVid }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (err) {
    console.error("videos function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};

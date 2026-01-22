const { getStore } = require("@netlify/blobs");

const STORE_NAME = "channel-picker-data";
const DATA_KEY = "app-state";

function ensureStoreShape(raw) {
  const base = {
    videos: [],
    currentVideoId: null,
    streams: [],
    currentStreamId: null,
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
    data.streams = raw.streams.map(normalizeStreamEntry).filter(Boolean);
  }

  if (typeof raw.currentStreamId === "string" || raw.currentStreamId === null) {
    data.currentStreamId = raw.currentStreamId;
  }

  if (
    data.currentStreamId &&
    !data.streams.find((s) => s.id === data.currentStreamId)
  ) {
    data.currentStreamId = data.streams[0]?.id || null;
  }

  return data;
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
  const embedSrcRaw =
    typeof stream.embedSrc === "string" ? stream.embedSrc.trim() : "";
  const resolvedEmbedSrc = embedSrcRaw || extractEmbedSrc(embedCode) || null;
  const sourceUrl =
    typeof stream.sourceUrl === "string" ? stream.sourceUrl.trim() : null;
  const network =
    typeof stream.network === "string" ? stream.network.trim() : "";
  const viewers =
    typeof stream.viewers === "number" && Number.isFinite(stream.viewers)
      ? stream.viewers
      : null;

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
    viewers,
  };
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

async function readStore() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(DATA_KEY, { type: "json" });
    return ensureStoreShape(raw);
  } catch (e) {
    console.error("Error reading store:", e);
    return ensureStoreShape();
  }
}

async function writeStore(data) {
  try {
    const store = getStore(STORE_NAME);
    const normalized = ensureStoreShape(data);
    await store.setJSON(DATA_KEY, normalized);
  } catch (e) {
    console.error("Error writing store:", e);
    throw e;
  }
}

module.exports = {
  readStore,
  writeStore,
  makeId,
  extractEmbedSrc,
  guessStreamTitle,
  normalizeStreamEntry,
  ensureStoreShape,
};

const {
  readStore,
  writeStore,
  makeId,
  extractEmbedSrc,
  guessStreamTitle,
  normalizeStreamEntry,
} = require("./lib/store");

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
    // GET /api/streams - list streams
    if (event.httpMethod === "GET") {
      const data = await readStore();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          streams: data.streams,
          currentStreamId: data.currentStreamId,
        }),
      };
    }

    // POST /api/streams - add new stream
    if (event.httpMethod === "POST") {
      const { title, embedCode, sandboxed } = JSON.parse(event.body || "{}");

      if (!embedCode || typeof embedCode !== "string" || !embedCode.trim()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing embedCode" }),
        };
      }

      const data = await readStore();
      const trimmedEmbed = embedCode.trim();
      const embedSrc = extractEmbedSrc(trimmedEmbed);
      const resolvedTitle = guessStreamTitle({
        providedTitle: title,
        embedCode: trimmedEmbed,
      });

      const newStream = normalizeStreamEntry({
        id: makeId(),
        title: resolvedTitle,
        embedCode: trimmedEmbed,
        embedSrc: embedSrc || null,
        sandboxed: sandboxed !== false,
      });

      if (!newStream) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Failed to normalize stream." }),
        };
      }

      data.streams.push(newStream);

      if (!data.currentStreamId) {
        data.currentStreamId = newStream.id;
      }

      await writeStore(data);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, stream: newStream }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (err) {
    console.error("streams function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};

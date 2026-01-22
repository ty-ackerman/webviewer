const { readStore, writeStore } = require("./lib/store");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const id = event.queryStringParameters?.id;

  if (!id) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing stream id" }),
    };
  }

  try {
    // DELETE /api/streams/:id
    if (event.httpMethod === "DELETE") {
      const data = await readStore();
      const beforeLen = data.streams.length;
      data.streams = data.streams.filter((s) => s.id !== id);

      if (data.currentStreamId === id) {
        data.currentStreamId = data.streams[0]?.id || null;
      }

      await writeStore(data);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          removed: beforeLen !== data.streams.length,
        }),
      };
    }

    // PATCH /api/streams/:id - update stream (e.g., sandboxed)
    if (event.httpMethod === "PATCH") {
      const { sandboxed } = JSON.parse(event.body || "{}");

      const data = await readStore();
      const stream = data.streams.find((s) => s.id === id);

      if (!stream) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Stream not found" }),
        };
      }

      let mutated = false;

      if (typeof sandboxed === "boolean") {
        stream.sandboxed = sandboxed;
        mutated = true;
      }

      if (!mutated) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "No updates provided" }),
        };
      }

      await writeStore(data);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, stream }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (err) {
    console.error("streams-manage function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};

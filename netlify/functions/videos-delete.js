const { readStore, writeStore } = require("./lib/store");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "DELETE") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const id = event.queryStringParameters?.id;

    if (!id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing video id" }),
      };
    }

    const data = await readStore();
    const beforeLen = data.videos.length;
    data.videos = data.videos.filter((v) => v.id !== id);

    if (data.currentVideoId === id) {
      data.currentVideoId = data.videos[0]?.id || null;
    }

    await writeStore(data);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        removed: beforeLen !== data.videos.length,
      }),
    };
  } catch (err) {
    console.error("videos-delete function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};

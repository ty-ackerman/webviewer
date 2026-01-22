const { readStore, writeStore } = require("./lib/store");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { id } = JSON.parse(event.body || "{}");

    const data = await readStore();
    const exists = data.videos.find((v) => v.id === id);

    if (!exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Video not found" }),
      };
    }

    data.currentVideoId = id;
    await writeStore(data);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, currentVideoId: id }),
    };
  } catch (err) {
    console.error("videos-select function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};

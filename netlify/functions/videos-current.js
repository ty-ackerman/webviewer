const { readStore } = require("./lib/store");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const data = await readStore();
    const current = data.videos.find((v) => v.id === data.currentVideoId) || null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        currentVideo: current
          ? {
              id: current.id,
              title: current.title,
              ytId: current.ytId,
              embedUrl: `https://www.youtube.com/embed/${current.ytId}`,
            }
          : null,
      }),
    };
  } catch (err) {
    console.error("videos-current function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};

const https = require("https");
const http = require("http");
const zlib = require("zlib");

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
          "Accept-Encoding": "gzip, deflate, br",
        },
      };

      const req = lib.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsRemaining <= 0) {
            res.resume();
            return reject(new Error("Too many redirects"));
          }
          const nextUrl = new URL(res.headers.location, urlObj).toString();
          res.resume();
          return load(nextUrl, redirectsRemaining - 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Remote responded with status ${res.statusCode}`));
        }

        const chunks = [];
        let totalLength = 0;
        res.on("data", (chunk) => {
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
          } catch {
            decodedBuffer = buffer;
          }

          resolve(decodedBuffer.toString("utf8"));
        });
      });

      req.on("error", reject);

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

  const textareaMatch = html.match(
    /<textarea[^>]*id=["']embedcode["'][^>]*>([\s\S]*?)<\/textarea>/i
  );
  let embedCode = textareaMatch ? textareaMatch[1].trim() : "";
  embedCode = decodeHtmlEntities(embedCode);

  if (!embedCode) {
    const iframeMatch = html.match(
      /<iframe[^>]+src=["'][^"']+["'][^>]*><\/iframe>/i
    );
    embedCode = iframeMatch ? decodeHtmlEntities(iframeMatch[0]) : "";
  }

  const ogTitleMatch = html.match(
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i
  );
  let title = ogTitleMatch ? ogTitleMatch[1] : "";

  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = titleMatch ? titleMatch[1] : "";
  }

  return {
    embedCode: embedCode.trim(),
    title: decodeHtmlEntities(title).trim(),
  };
}

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
    const { url } = JSON.parse(event.body || "{}");

    if (typeof url !== "string" || !url.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing url" }),
      };
    }

    let normalizedUrl;
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "URL must be http or https." }),
        };
      }
      normalizedUrl = parsed.toString();
    } catch (err) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid URL." }),
      };
    }

    const html = await fetchRemoteDocument(normalizedUrl);
    const { embedCode, title } = extractEmbedFromHtml(html);

    if (!embedCode) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Embed code not found on that page." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, embedCode, title }),
    };
  } catch (err) {
    console.error("streams-extract function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch embed code." }),
    };
  }
};

const fs = require("fs");
const path = require("path");
const {
  getTeamName,
  generateEmbedUrl,
  generateIframeHtml,
  formatGameTitle,
} = require("./lib/nba-teams");

/**
 * Convert 24h time to 12h format
 * @param {string} time24 - Time in 24h format (e.g., "21:30")
 * @returns {string} Time in 12h format (e.g., "9:30 PM ET")
 */
function formatTime24to12(time24) {
  if (!time24) return null;
  const [hours, minutes] = time24.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period} ET`;
}

/**
 * Get the effective game date in YYYY-MM-DD format (Eastern Time)
 * Before 9am ET: show yesterday's games (late night games still in progress)
 * After 9am ET: show today's games
 */
function getEffectiveDateET() {
  const now = new Date();
  // Convert to Eastern Time
  const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etDate = new Date(etString);
  
  const hour = etDate.getHours();
  
  // Before 9am ET, show yesterday's games
  if (hour < 9) {
    etDate.setDate(etDate.getDate() - 1);
  }
  
  const year = etDate.getFullYear();
  const month = String(etDate.getMonth() + 1).padStart(2, "0");
  const day = String(etDate.getDate()).padStart(2, "0");
  
  return `${year}-${month}-${day}`;
}

/**
 * Load schedule from JSON file
 */
function loadSchedule() {
  try {
    // In Netlify Functions, we need to read from the published site
    // The file will be at the root of the publish directory
    const possiblePaths = [
      path.join(__dirname, "../../public/data/nba-schedule.json"),
      path.join(process.cwd(), "public/data/nba-schedule.json"),
      "/var/task/public/data/nba-schedule.json",
    ];

    for (const filePath of possiblePaths) {
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          return JSON.parse(content);
        }
      } catch (e) {
        // Try next path
      }
    }

    return { season: "", games: [] };
  } catch (err) {
    console.error("Error loading schedule:", err);
    return { season: "", games: [] };
  }
}

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
    const schedule = loadSchedule();
    const today = getEffectiveDateET();

    // Allow override via query param for testing
    const queryDate = event.queryStringParameters?.date;
    const targetDate = queryDate || today;

    // Filter games for target date
    const todaysGames = schedule.games
      .filter((game) => game.date === targetDate)
      .map((game) => {
        // Format: { date, time, home, away, location, label }
        // time is 24h format like "21:30"
        const timeFormatted = game.time ? formatTime24to12(game.time) : null;
        
        return {
          date: game.date,
          away: game.away,
          home: game.home,
          awayName: getTeamName(game.away),
          homeName: getTeamName(game.home),
          title: formatGameTitle(game),
          embedSrc: generateEmbedUrl(game),
          embedCode: generateIframeHtml(game),
          time: game.time || null,  // raw 24h format for calculations
          startTime: timeFormatted,
          location: game.location || null,
          label: game.label || null,
        };
      });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        date: targetDate,
        season: schedule.season,
        games: todaysGames,
        totalGamesInSchedule: schedule.games.length,
      }),
    };
  } catch (err) {
    console.error("nba-today function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};

/**
 * NBA team code to full name mapping
 * Codes are lowercase 3-letter abbreviations used by ppv.to
 */
const NBA_TEAMS = {
  atl: { name: "Hawks", full: "Atlanta Hawks" },
  bos: { name: "Celtics", full: "Boston Celtics" },
  bkn: { name: "Nets", full: "Brooklyn Nets" },
  cha: { name: "Hornets", full: "Charlotte Hornets" },
  chi: { name: "Bulls", full: "Chicago Bulls" },
  cle: { name: "Cavaliers", full: "Cleveland Cavaliers" },
  dal: { name: "Mavericks", full: "Dallas Mavericks" },
  den: { name: "Nuggets", full: "Denver Nuggets" },
  det: { name: "Pistons", full: "Detroit Pistons" },
  gsw: { name: "Warriors", full: "Golden State Warriors" },
  hou: { name: "Rockets", full: "Houston Rockets" },
  ind: { name: "Pacers", full: "Indiana Pacers" },
  lac: { name: "Clippers", full: "Los Angeles Clippers" },
  lal: { name: "Lakers", full: "Los Angeles Lakers" },
  mem: { name: "Grizzlies", full: "Memphis Grizzlies" },
  mia: { name: "Heat", full: "Miami Heat" },
  mil: { name: "Bucks", full: "Milwaukee Bucks" },
  min: { name: "Timberwolves", full: "Minnesota Timberwolves" },
  nop: { name: "Pelicans", full: "New Orleans Pelicans" },
  nyk: { name: "Knicks", full: "New York Knicks" },
  okc: { name: "Thunder", full: "Oklahoma City Thunder" },
  orl: { name: "Magic", full: "Orlando Magic" },
  phi: { name: "76ers", full: "Philadelphia 76ers" },
  phx: { name: "Suns", full: "Phoenix Suns" },
  por: { name: "Trail Blazers", full: "Portland Trail Blazers" },
  sac: { name: "Kings", full: "Sacramento Kings" },
  sas: { name: "Spurs", full: "San Antonio Spurs" },
  tor: { name: "Raptors", full: "Toronto Raptors" },
  uta: { name: "Jazz", full: "Utah Jazz" },
  was: { name: "Wizards", full: "Washington Wizards" },
};

// Reverse lookup: full team name -> code
const TEAM_NAME_TO_CODE = {};
for (const [code, info] of Object.entries(NBA_TEAMS)) {
  TEAM_NAME_TO_CODE[info.full.toLowerCase()] = code;
  TEAM_NAME_TO_CODE[info.name.toLowerCase()] = code;
}

/**
 * Get team code from full name
 * @param {string} fullName - Full team name (e.g., "Los Angeles Lakers")
 * @returns {string} 3-letter code or empty string if not found
 */
function getTeamCode(fullName) {
  const normalized = (fullName || "").toLowerCase().trim();
  return TEAM_NAME_TO_CODE[normalized] || "";
}

/**
 * Get team short name from code
 * @param {string} code - 3-letter team code (e.g., "gsw")
 * @returns {string} Team name or uppercase code if not found
 */
function getTeamName(code) {
  const normalized = (code || "").toLowerCase().trim();
  const team = NBA_TEAMS[normalized];
  return team ? team.name : code.toUpperCase();
}

/**
 * Generate embed URL from game data
 * @param {object} game - Game object with date, away, home
 * @returns {string} Embed URL for modistreams
 */
function generateEmbedUrl(game) {
  const { date, away, home } = game;
  return `https://modistreams.org/embed/nba/${date}/${away}-${home}`;
}

/**
 * Generate iframe HTML for a game
 * @param {object} game - Game object with date, away, home
 * @returns {string} Full iframe HTML
 */
function generateIframeHtml(game) {
  const src = generateEmbedUrl(game);
  return `<iframe id="player" marginheight="0" marginwidth="0" src="${src}" scrolling="no" allowfullscreen="yes" allow="encrypted-media; picture-in-picture;" width="100%" height="100%" frameborder="0" style="position:absolute;"></iframe>`;
}

/**
 * Format game title for display
 * @param {object} game - Game object with away, home
 * @returns {string} Formatted title like "Warriors @ Mavericks"
 */
function formatGameTitle(game) {
  const awayName = getTeamName(game.away);
  const homeName = getTeamName(game.home);
  return `${awayName} @ ${homeName}`;
}

module.exports = {
  NBA_TEAMS,
  TEAM_NAME_TO_CODE,
  getTeamCode,
  getTeamName,
  generateEmbedUrl,
  generateIframeHtml,
  formatGameTitle,
};

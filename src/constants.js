const path = require("path");

module.exports = {
  COUNTRY_FILTER: ["🇩🇪", "DE", "Germany"],
  CACHE_FILE: path.join(__dirname, "../cache/cache.json"),
  CACHE_TTL_MS: 10 * 60 * 1000,
};

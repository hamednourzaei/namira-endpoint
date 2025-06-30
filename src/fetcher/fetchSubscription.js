const https = require("https");
const fs = require("fs");
const path = require("path");
const { CACHE_FILE, CACHE_TTL_MS } = require("../constants");

function fetchSubscription(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", (err) => reject(err));
  });
}

function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const content = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    if (Date.now() - content.timestamp < CACHE_TTL_MS) return content.data;
  } catch {}
  return null;
}

function writeCache(data) {
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ timestamp: Date.now(), data }, null, 2),
    "utf-8"
  );
}

module.exports = { fetchSubscription, readCache, writeCache };

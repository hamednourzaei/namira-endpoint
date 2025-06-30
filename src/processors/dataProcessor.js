const fs = require("fs");
const path = require("path");
const { parseURL } = require("../parsers");
const OUTPUT_DIR = path.join(__dirname, "../../outputs");
const CACHE_FILE = path.join(__dirname, "../../cache", "cache.json");  // مسیر کامل فایل کش

// بررسی وجود پوشه کش و ساخت آن
const cacheDir = path.dirname(CACHE_FILE);
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

function processData(data) {
  const decoded = Buffer.from(data.trim(), "base64").toString("utf-8");
  const lines = decoded
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const parsed = lines.map(parseURL).filter(Boolean);

  // حذف تکراری
  const unique = [];
  const seen = new Set();

  for (const p of parsed) {
    const key = `${p.server}:${p.port}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  // ذخیره فایل‌ها
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "configs.txt"),
    unique.map((p) => p.raw).join("\n"),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "configs.json"),
    JSON.stringify(unique, null, 2),
    "utf-8"
  );

  const csvHeader = "id,type,tag,server,port,raw\n";
  const csvRows = unique
    .map((p) =>
      [
        `"${p.id}"`,
        `"${p.type}"`,
        `"${p.tag.replace(/"/g, '""')}"`,
        `"${p.server}"`,
        `"${p.port}"`,
        `"${p.raw.replace(/"/g, '""')}"`,
      ].join(",")
    )
    .join("\n");

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "configs.csv"),
    csvHeader + csvRows,
    "utf-8"
  );

  console.log(`✅ ${unique.length} unique configs saved to outputs/`);
}

module.exports = { processData };

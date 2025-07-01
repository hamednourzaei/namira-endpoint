const fs = require("fs");
const path = require("path");
const { parseURL } = require("../parsers");
const OUTPUT_DIR = path.join(__dirname, "../../outputs");
const CACHE_FILE = path.join(__dirname, "../../cache", "cache.json");

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

  console.log(`📜 Total input lines: ${lines.length}`);

  const parsed = lines.map(parseURL).filter(Boolean);
  console.log(`🔍 Parsed configs: ${parsed.length}`);

  // فیلتر کردن کانفیگ‌های تکراری بر اساس server و port
  const seen = new Set();
  const finalList = parsed.filter((item) => {
    // نرمال‌سازی server و port برای جلوگیری از تفاوت‌های جزئی
    const uniqueKey = `${item.server.trim().toLowerCase()}:${item.port}`.trim();
    if (seen.has(uniqueKey)) {
      return false;
    }
    seen.add(uniqueKey);
    return true;
  });

  console.log(`✅ Unique configs after deduplication: ${finalList.length}`);

  // پاک کردن فایل‌های خروجی قبلی
  const outputFiles = ["configs.txt", "configs.json", "configs.csv"];
  outputFiles.forEach((file) => {
    const filePath = path.join(OUTPUT_DIR, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Cleared old file: ${file}`);
    }
  });

  // ذخیره فایل‌ها
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "configs.txt"),
    finalList.map((p) => p.raw).join("\n"),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "configs.json"),
    JSON.stringify(finalList, null, 2),
    "utf-8"
  );

  const csvHeader = "id,type,tag,server,port,raw\n";
  const csvRows = finalList
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

  console.log(`💾 ${finalList.length} unique configs saved to outputs/`);
}

module.exports = { processData };
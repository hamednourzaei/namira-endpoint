const {
  fetchSubscription,
  readCache,
  writeCache,
} = require("./src/fetcher/fetchSubscription");
const { processData } = require("./src/processors/dataProcessor");

const SUB_URL = "https://namira-web.vercel.app/api/subscription";

(async () => {
  try {
    let data = readCache();
    if (!data) {
      console.log("🚀 Fetching new subscription data...");
      data = await fetchSubscription(SUB_URL);
      writeCache(data);
    } else {
      console.log("⚡️ Using cached data...");
    }
    processData(data);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();

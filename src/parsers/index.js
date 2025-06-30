const parseSS = require("./ssParser");
const parseVmess = require("./vmessParser");
const parseVlessOrTrojan = require("./vlessParser");
const { v4: uuidv4 } = require("uuid");
const { COUNTRY_FILTER } = require("../constants");

function parseURL(line) {
  let parsed = null;

  if (line.startsWith("ss://")) {
    parsed = parseSS(line);
  } else if (line.startsWith("vmess://")) {
    parsed = parseVmess(line);
  } else if (line.startsWith("vless://") || line.startsWith("trojan://")) {
    parsed = parseVlessOrTrojan(line);
  } else {
    return null;
  }

  if (!parsed) return null;

  // فیلتر بر اساس کشور
  const matched = COUNTRY_FILTER.some((c) => parsed.tag.includes(c));
  if (!matched) return null;

  return {
    id: uuidv4(),
    ...parsed,
    raw: line,
  };
}

module.exports = { parseURL };

module.exports = function parseVlessOrTrojan(line) {
  try {
    const [full, tagParam] = line.split("#");
    const type = line.split("://")[0];
    const tag = decodeURIComponent(tagParam || "");
    const address = full.split("@")[1];
    if (!address) return null;
    const portMatch = address.match(/:(\d+)/);
    if (!portMatch) return null;
    const server = address.split(":")[0];
    const port = parseInt(portMatch[1]);

    return { type, tag, server, port };
  } catch {
    return null;
  }
};

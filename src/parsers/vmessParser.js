module.exports = function parseVmess(line) {
  try {
    const decoded = Buffer.from(
      line.replace("vmess://", ""),
      "base64"
    ).toString("utf-8");
    const parsed = JSON.parse(decoded);
    return {
      type: "vmess",
      tag: parsed.ps || "",
      server: parsed.add,
      port: parseInt(parsed.port),
    };
  } catch {
    return null;
  }
};

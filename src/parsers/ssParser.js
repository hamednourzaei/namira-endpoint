module.exports = function parseSS(url) {
    try {
      const base = url.replace("ss://", "").split("#");
      const tag = decodeURIComponent(base[1] || "Unnamed");
      const decoded = Buffer.from(base[0], "base64").toString("utf-8");
      let [methodPassword, serverPort] = decoded.split("@");
      let [method, password] = methodPassword.split(":");
      let [server, port] = serverPort.split(":");
  
      return { type: "ss", tag, method, password, server, port: parseInt(port) };
    } catch {
      return null;
    }
  };
  
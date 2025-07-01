const fs = require("fs").promises;
const net = require("net");
const tls = require("tls");
const WebSocket = require("ws");
const ping = require("ping");

const INPUT_FILE = "outputs/configs.txt";
const OUTPUT_FILE = "outputs/good.txt";
const MAX_CONFIGS = 10;
const TIMEOUT = 5000; // میلی‌ثانیه
const RETRIES = 5;
const VALID_SS_METHODS = [
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-poly1305",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
];

function validateUUID(uuid) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(uuid.toLowerCase());
}

function validateSSMethod(method) {
  return VALID_SS_METHODS.includes(method);
}

function parseQuery(queryStr) {
  const params = {};
  if (!queryStr) return params;
  const pairs = queryStr.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    params[key] = value ? decodeURIComponent(value) : "";
  }
  return params;
}

function parseVlessURL(urlStr) {
  try {
    urlStr = urlStr.trim();
    const raw = urlStr.split("vless://")[1];
    const [uuid, rest] = raw.split("@");
    if (!validateUUID(uuid)) {
      console.log("❌ Invalid UUID format");
      return null;
    }
    const [hostPort, ...queryPart] = rest.split("?");
    const [host, port] = hostPort.split(":");

    const query = parseQuery(queryPart[0]);
    const hostHeader = query.host || "";
    const security = query.security || "";
    const wsPath = query.path || "/";

    return {
      uuid,
      host,
      port: parseInt(port),
      hostHeader,
      tls: ["tls", "reality", "xtls"].includes(security),
      type: query.type || "tcp",
      path: wsPath,
      full: urlStr,
    };
  } catch (e) {
    console.log(`❌ Parse VLESS failed: ${e.message}`);
    return null;
  }
}

function parseVmessURL(urlStr) {
  try {
    const raw = urlStr.split("vmess://")[1];
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const config = JSON.parse(decoded);
    const uuid = config.id;
    if (!validateUUID(uuid)) {
      console.log("❌ Invalid UUID format");
      return null;
    }
    return {
      uuid,
      host: config.add,
      port: parseInt(config.port),
      hostHeader: config.host || config.add,
      tls: config.tls === "tls",
      type: config.net || "tcp",
      path: config.path || "/",
      full: urlStr,
    };
  } catch (e) {
    console.log(`❌ Parse VMESS failed: ${e.message}`);
    return null;
  }
}

function parseTrojanURL(urlStr) {
  try {
    const raw = urlStr.split("trojan://")[1];
    const [password, rest] = raw.split("@");
    const decodedPassword = decodeURIComponent(password);
    if (!decodedPassword) {
      console.log("❌ Empty password");
      return null;
    }
    const [hostPort, ...queryPart] = rest.split("?");
    const [host, port] = hostPort.split(":");
    const query = parseQuery(queryPart[0]);
    const hostHeader = query.sni || host;
    const wsPath = query.path || "/";
    return {
      password: decodedPassword,
      host,
      port: parseInt(port),
      hostHeader,
      tls: true,
      type: query.type || "tcp",
      path: wsPath,
      full: urlStr,
    };
  } catch (e) {
    console.log(`❌ Parse Trojan failed: ${e.message}`);
    return null;
  }
}

function parseSSURL(urlStr) {
  try {
    const raw = urlStr.split("ss://")[1].split("#")[0];
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const [methodPassword, hostPort] = decoded.split("@");
    const [method, password] = methodPassword.split(":");
    if (!validateSSMethod(method)) {
      console.log(`❌ Invalid SS encryption method: ${method}`);
      return null;
    }
    if (!password) {
      console.log("❌ Empty password");
      return null;
    }
    const [host, port] = hostPort.split(":");
    return {
      method,
      password,
      host,
      port: parseInt(port),
      tls: false,
      type: "tcp",
      full: urlStr,
    };
  } catch (e) {
    console.log(`❌ Parse SS failed: ${e.message}`);
    return null;
  }
}

function parseConfig(line) {
  if (line.startsWith("vless://")) return parseVlessURL(line);
  if (line.startsWith("vmess://")) return parseVmessURL(line);
  if (line.startsWith("trojan://")) return parseTrojanURL(line);
  if (line.startsWith("ss://")) return parseSSURL(line);
  return null;
}

async function resolveDNS(host) {
  const dns = require("dns").promises;
  try {
    const addresses = await dns.lookup(host);
    const ip = addresses.address;
    if (
      ip.startsWith("10.") ||
      ip.startsWith("172.16.") ||
      ip.startsWith("192.168.")
    ) {
      console.log(`❌ Private IP detected: ${ip}`);
      return null;
    }
    console.log(`🌐 DNS Resolved: ${host} → ${ip}`);
    return ip;
  } catch (e) {
    console.log(`❌ DNS Failed for ${host}: ${e.message}`);
    return null;
  }
}

async function testWebSocket(config) {
  if (config.type === "ws") {
    const wsPath = config.path || "/";
    const host = config.host;
    const port = config.port;
    const wsURL = `ws://${host}:${port}${wsPath}`;
    try {
      const ws = new WebSocket(wsURL, { timeout: TIMEOUT });
      await new Promise((resolve, reject) => {
        ws.on("open", () => {
          console.log("✅ WebSocket Direct OK");
          ws.close();
          resolve(true);
        });
        ws.on("error", (e) => {
          console.log(`❌ WebSocket Direct Failed: ${e.message}`);
          if (e.code === "ETIMEDOUT") {
            reject(new Error("WebSocket Timeout"));
          } else {
            reject(false);
          }
        });
      });
      return true;
    } catch (e) {
      if (e.message === "WebSocket Timeout") {
        console.log("❌ WebSocket Timeout detected, rejecting config");
        return false;
      }
      return false;
    }
  }
  return true;
}

async function testTCPTLS(config) {
  const host = config.host;
  const port = config.port;
  const hostHeader = config.hostHeader || host;

  const ip = await resolveDNS(host);
  if (!ip) return false;

  const pingResult = await ping.promise.probe(host, {
    timeout: TIMEOUT / 1000,
  });
  if (pingResult.alive) {
    console.log(`✅ Ping OK (${Math.round(pingResult.avg)}ms)`);
  } else {
    console.log("❌ Ping Failed");
    return false;
  }

  let success = false;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      console.log(`🔁 Attempt ${attempt}...`);
      const start = Date.now();
      const sock = await new Promise((resolve, reject) => {
        const socket = net.createConnection(
          { host: ip, port, timeout: TIMEOUT },
          () => resolve(socket)
        );
        socket.on("error", (e) => reject(e));
      });
      const tcpTime = Date.now() - start;
      console.log(`✅ TCP OK (${tcpTime}ms)`);

      if (config.tls) {
        const tlsSock = await new Promise((resolve, reject) => {
          const socket = tls.connect(
            {
              socket: sock,
              servername: hostHeader,
              rejectUnauthorized: false,
              timeout: TIMEOUT,
            },
            () => resolve(socket)
          );
          socket.on("error", (e) => reject(e));
        });
        const cert = tlsSock.getPeerCertificate();
        const expiry = cert.valid_to || "N/A";
        console.log(`✅ TLS OK - Expiry: ${expiry}`);
        tlsSock.end();
      }
      sock.end();
      success = true;
      break;
    } catch (e) {
      console.log(`❌ Failed attempt ${attempt}: ${e.message}`);
      if (e.code === "ETIMEDOUT") {
        console.log("❌ Timeout detected, rejecting config");
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return success;
}

async function main() {
  try {
    const data = await fs.readFile(INPUT_FILE, "utf-8");
    const lines = data
      .split("\n")
      .filter((line) => line.trim())
      .slice(-MAX_CONFIGS);
    console.log("🔁 Reading configs...");
    const good = [];

    for (const line of lines) {
      console.log(`\n🔍 Testing: ${line.slice(0, 60)}...`);
      const config = parseConfig(line);
      if (config) {
        if (config.type === "ws") {
          if ((await testWebSocket(config)) && (await testTCPTLS(config))) {
            good.push(config.full);
          }
        } else if (await testTCPTLS(config)) {
          good.push(config.full);
        }
      }
      console.log("—".repeat(48));
    }

    await fs.mkdir("outputs", { recursive: true });
    await fs.writeFile(OUTPUT_FILE, good.join("\n"), "utf-8");
    console.log(
      `\n✅ Done. ${good.length} configs passed and saved in ${OUTPUT_FILE}`
    );
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

main();

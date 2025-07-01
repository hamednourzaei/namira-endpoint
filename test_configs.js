const fs = require("fs").promises;
const net = require("net");
const tls = require("tls");
const WebSocket = require("ws");
const dns = require("dns").promises;

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const INPUT_FILE = "outputs/configs.txt";
const OUTPUT_FILE = "outputs/good.txt";
const MAX_CONFIGS = 100;
const TIMEOUT = 3000;
const RETRIES = 3;
const MAX_CONCURRENT = 20;
const VALID_SS_METHODS = [
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-poly1305",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
];

function validateUUID(uuid) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      xtls: security === "xtls",
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
      xtls: false,
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
      xtls: false,
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
      xtls: false,
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const addresses = await dns.lookup(host);
      const ip = addresses.address;
      if (ip.startsWith("10.") || ip.startsWith("172.16.") || ip.startsWith("192.168.")) {
        console.log(`❌ Private IP detected: ${ip}`);
        return null;
      }
      console.log(`🌐 DNS Resolved: ${host} → ${ip}`);
      return ip;
    } catch (e) {
      console.log(`❌ DNS Failed for ${host} (Attempt ${attempt}): ${e.message}`);
      if (attempt === 3) return null;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function testConnection(host, port) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port, timeout: TIMEOUT });
        socket.on("connect", () => {
          console.log(`✅ TCP Connection OK (Attempt ${attempt})`);
          socket.end();
          resolve(true);
        });
        socket.on("error", (e) => {
          console.log(`❌ TCP Connection Failed (Attempt ${attempt}): ${e.message}`);
          reject(e);
        });
        socket.on("timeout", () => {
          console.log(`❌ TCP Connection Timeout (Attempt ${attempt})`);
          socket.end();
          reject(new Error("Timeout"));
        });
      });
    } catch (e) {
      if (attempt === RETRIES) return false;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function testWebSocket(config) {
  if (config.type === "ws") {
    const protocol = config.tls ? "wss" : "ws";
    const wsURL = `${protocol}://${config.host}:${config.port}${config.path}`;
    try {
      const ws = new WebSocket(wsURL, {
        headers: { Host: config.hostHeader || config.host },
      });
      await new Promise((resolve, reject) => {
        ws.on("open", () => {
          console.log(`✅ WebSocket (${protocol.toUpperCase()}) OK`);
          ws.close();
          resolve(true);
        });
        ws.on("error", (e) => {
          console.log(`❌ WebSocket ${protocol.toUpperCase()} Failed: ${e.message}`);
          if (e.code === "ETIMEDOUT") reject(new Error("WebSocket Timeout"));
          else reject(false);
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
  const ip = await resolveDNS(config.host);
  if (!ip) return false;

  const connSuccess = await testConnection(ip, config.port);
  if (!connSuccess) return false;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      console.log(`🔁 Attempt ${attempt}...`);
      const sock = await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: ip, port: config.port, timeout: TIMEOUT }, () => resolve(socket));
        socket.on("error", (e) => reject(e));
      });
      console.log(`✅ TCP OK`);

      if (config.tls || config.xtls) {
        const tlsSock = await new Promise((resolve, reject) => {
          const socket = tls.connect(
            {
              socket: sock,
              servername: config.hostHeader || config.host,
              rejectUnauthorized: false,
              timeout: TIMEOUT,
            },
            () => resolve(socket)
          );
          socket.on("error", (e) => reject(e));
        });
        const cert = tlsSock.getPeerCertificate();
        const expiry = cert.valid_to || "N/A";
        const type = config.xtls ? "XTLS" : "TLS";
        console.log(`✅ ${type} OK - Expiry: ${expiry}`);
        tlsSock.end();
      }
      sock.end();
      return true;
    } catch (e) {
      console.log(`❌ Failed attempt ${attempt}: ${e.message}`);
      if (e.code === "ETIMEDOUT") {
        console.log("❌ Timeout detected, rejecting config");
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function testConfig(line) {
  console.log(`\n🔍 Testing: ${line.slice(0, 60)}...`);
  const config = parseConfig(line);
  if (!config) {
    console.log(`❌ Config parsing failed for: ${line.slice(0, 60)}...`);
    return null;
  }
  try {
    if (config.type === "ws") {
      if ((await testWebSocket(config)) && (await testTCPTLS(config))) {
        console.log(`✅ Config passed: ${line.slice(0, 60)}...`);
        return config.full;
      }
    } else if (await testTCPTLS(config)) {
      console.log(`✅ Config passed: ${line.slice(0, 60)}...`);
      return config.full;
    }
  } catch (e) {
    console.log(`❌ Config failed: ${line.slice(0, 60)}... Error: ${e.message}`);
  }
  return null;
}

async function processInBatches(array, batchSize, processFn) {
  const results = [];
  for (let i = 0; i < array.length; i += batchSize) {
    const batch = array.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processFn));
    results.push(...batchResults.filter((result) => result !== null));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return results;
}

async function main() {
  try {
    const data = await fs.readFile(INPUT_FILE, "utf-8");
    const lines = data.split("\n").filter((line) => line.trim()).slice(-MAX_CONFIGS);
    console.log("🔁 Reading configs...");

    const good = await processInBatches(lines, MAX_CONCURRENT, testConfig);

    await fs.mkdir("outputs", { recursive: true });
    await fs.writeFile(OUTPUT_FILE, good.join("\n"), "utf-8");
    console.log(`\n✅ Done. ${good.length} configs passed and saved in ${OUTPUT_FILE}`);
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

main();
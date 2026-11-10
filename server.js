import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import { WebSocketServer, WebSocket } from "ws";
import BotEngine from "./core/BotEngine.js";
import Client from "./core/Client.js";
import { createLicenseToken, licenseAuth, verifyLicenseToken } from "./core/LicenseAuth.js";
import createBotManagerRouter from "./botManager.js";

const app = express();
const engine = new BotEngine();
const PORT = Number(process.env.PORT) || 3000;

const mysqlUrl = process.env.MYSQL_URL ||
  (String(process.env.DATABASE_URL || "").startsWith("mysql://") ? process.env.DATABASE_URL : "");

let dbPool = null;
if (mysqlUrl) {
  dbPool = mysql.createPool(mysqlUrl);
} else if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
  dbPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ...(process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

async function validateLicenseKey(licenseKey) {
  if (!dbPool) {
    return { valid: false, reason: "Database licenze non configurato" };
  }
  if (typeof licenseKey !== "string" || !licenseKey.trim()) {
    return { valid: false, reason: "Chiave licenza mancante" };
  }

  try {
    const [rows] = await dbPool.query(
      "SELECT license_key, expire_date, max_bots FROM licenses WHERE license_key = ? AND is_active = 1 AND (expire_date IS NULL OR expire_date > NOW()) LIMIT 1",
      [licenseKey.trim()]
    );
    if (!rows.length) return { valid: false, reason: "Licenza non valida o scaduta" };
    return { valid: true, data: rows[0] };
  } catch (error) {
    console.error("[license-db]", error.message);
    return { valid: false, reason: "Servizio licenze temporaneamente non disponibile" };
  }
}

engine.setLicenseValidator(validateLicenseKey);
const requireLicense = licenseAuth(validateLicenseKey);

const allowedOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin non autorizzata"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "32kb" }));

const verifyAttempts = new Map();
function allowVerifyAttempt(ip) {
  const now = Date.now();
  const current = verifyAttempts.get(ip);
  if (!current || now - current.startedAt > 60_000) {
    verifyAttempts.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

app.post("/api/verify-license", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!allowVerifyAttempt(ip)) {
    return res.status(429).json({ valid: false, message: "Troppi tentativi. Riprova tra un minuto." });
  }

  const licenseKey = String(req.body?.licenseKey || req.body?.key || "").trim();
  const result = await validateLicenseKey(licenseKey);
  if (!result.valid) {
    return res.status(401).json({ valid: false, message: result.reason });
  }

  try {
    const maxBots = Math.max(1, Math.min(
      Number(result.data.max_bots) || 1,
      Number(process.env.MAX_BOTS_PER_SESSION) || 40
    ));
    const access = createLicenseToken(licenseKey, maxBots);
    return res.json({
      valid: true,
      token: access.token,
      tokenType: "Bearer",
      expiresIn: access.expiresIn,
      expireDate: result.data.expire_date,
      maxBots,
    });
  } catch (error) {
    return res.status(503).json({ valid: false, message: error.message });
  }
});

app.use("/api", createBotManagerRouter({ engine, requireLicense }));

app.get(["/", "/health"], (_req, res) => {
  res.json({ status: "ok", service: "ZeroTheLegend Bot Engine" });
});

app.get("/stats", (_req, res) => {
  res.json({
    uptimeSeconds: Math.floor(process.uptime()),
    connectedPanels: connectedPanels.size,
    ...engine.stats(),
  });
});

const server = app.listen(PORT, () => {
  console.log(`ZeroTheLegend backend listening on ${PORT}`);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const connectedPanels = new Set();

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  let ownerId = null;
  let panelClient = null;
  let authTimer = setTimeout(() => {
    try { ws.close(1008, "Autenticazione richiesta"); } catch {}
  }, 8000);

  ws.on("message", async (data, isBinary) => {
    try {
      if (!ownerId) {
        if (isBinary) return ws.close(1008, "Primo messaggio di autenticazione richiesto");
        const authMessage = JSON.parse(data.toString("utf8"));
        if (authMessage.type !== "auth" || typeof authMessage.token !== "string") {
          return ws.close(1008, "Messaggio di autenticazione non valido");
        }

        const payload = verifyLicenseToken(authMessage.token);
        const license = await validateLicenseKey(payload.sub);
        if (!license.valid) return ws.close(1008, "Licenza non valida");

        ownerId = crypto.createHash("sha256").update(payload.sub).digest("hex");
        clearTimeout(authTimer);
        authTimer = null;
        connectedPanels.add(ownerId);
        engine.setPanelConnected(ownerId, true);
        panelClient = new Client(ws, engine, ownerId);
        ws.send(JSON.stringify({ type: "ready", status: engine.status(ownerId) }));
        return;
      }

      if (isBinary) {
        panelClient?.handleMessage(data);
        return;
      }

      const message = JSON.parse(data.toString("utf8"));
      if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
      } else if (message.type === "status") {
        ws.send(JSON.stringify({ type: "status", status: engine.status(ownerId) }));
      }
    } catch {
      try { ws.close(1008, "Messaggio non valido"); } catch {}
    }
  });

  ws.on("close", () => {
    if (authTimer) clearTimeout(authTimer);
    if (ownerId) {
      connectedPanels.delete(ownerId);
      // Il pannello può disconnettersi: la sessione bot resta attiva.
      panelClient?.disconnect();
    }
  });

  ws.on("error", () => {
    if (authTimer) clearTimeout(authTimer);
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping bot sessions`);
  engine.stopAll();

  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.close(1001, "Server shutdown");
  }

  wss.close();
  server.close(async () => {
    if (dbPool) {
      try { await dbPool.end(); } catch {}
    }
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server, engine, validateLicenseKey };

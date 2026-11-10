import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import BotEngine from "./core/BotEngine.js";
import Client from "./core/Client.js";
import { licenseAuth, verifyLicenseToken } from "./core/LicenseAuth.js";
import createBotManagerRouter from "./botManager.js";

const app = express();
app.set("trust proxy", 1);
const engine = new BotEngine();
const PORT = Number(process.env.PORT) || 3000;
const requireLicense = licenseAuth();

const allowedOrigins = String(process.env.CORS_ORIGINS || "https://agar.io,https://www.agar.io,https://delt.io,https://www.delt.io,https://agar.cc,https://www.agar.cc,https://agar.su,https://www.agar.su")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin non autorizzata"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "32kb" }));
app.use("/api", createBotManagerRouter({ engine, requireLicense }));

app.get(["/", "/health"], (_req, res) => res.json({ status: "ok", service: "ZeroTheLegend Bot Engine", licenseAuth: "RS256" }));
app.get("/stats", (_req, res) => res.json({ uptimeSeconds: Math.floor(process.uptime()), connectedPanels: connectedPanels.size, ...engine.stats() }));

const server = app.listen(PORT, () => console.log(`ZeroTheLegend backend listening on ${PORT}`));
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const connectedPanels = new Set();

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
});

wss.on("connection", (ws) => {
  let ownerId = null;
  let panelClient = null;
  let tokenExpiryTimer = null;
  let authTimer = setTimeout(() => { try { ws.close(1008, "Autenticazione richiesta"); } catch {} }, 8000);

  ws.on("message", (data, isBinary) => {
    try {
      if (!ownerId) {
        if (isBinary) return ws.close(1008, "Primo messaggio di autenticazione richiesto");
        const authMessage = JSON.parse(data.toString("utf8"));
        if (authMessage.type !== "auth" || typeof authMessage.token !== "string") return ws.close(1008, "Messaggio di autenticazione non valido");
        const payload = verifyLicenseToken(authMessage.token);
        ownerId = payload.sub;
        tokenExpiryTimer = setTimeout(() => { try { ws.close(1008, "Token scaduto: riconnettersi"); } catch {} }, Math.max(0, payload.exp * 1000 - Date.now()));
        clearTimeout(authTimer); authTimer = null;
        connectedPanels.add(ownerId);
        engine.setPanelConnected(ownerId, true);
        panelClient = new Client(ws, engine, ownerId);
        ws.send(JSON.stringify({ type: "ready", status: engine.status(ownerId) }));
        return;
      }
      if (isBinary) { panelClient?.handleMessage(data); return; }
      const message = JSON.parse(data.toString("utf8"));
      if (message.type === "ping") ws.send(JSON.stringify({ type: "pong", at: Date.now() }));
      else if (message.type === "status") ws.send(JSON.stringify({ type: "status", status: engine.status(ownerId) }));
    } catch { try { ws.close(1008, "Messaggio o token non valido"); } catch {} }
  });

  ws.on("close", () => {
    if (authTimer) clearTimeout(authTimer);
    if (tokenExpiryTimer) clearTimeout(tokenExpiryTimer);
    if (ownerId) { connectedPanels.delete(ownerId); panelClient?.disconnect(); }
  });
  ws.on("error", () => { if (authTimer) clearTimeout(authTimer); if (tokenExpiryTimer) clearTimeout(tokenExpiryTimer); });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping bot sessions`);
  engine.stopAll();
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.close(1001, "Server shutdown");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app, server, engine };

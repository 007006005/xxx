// server.js — ZeroExtens Bots PRO (improved)
// Miglioramenti:
//  - Health check risponde 200 (non 500!)
//  - Endpoint /stats restituisce JSON live (client connessi, bot totali, uptime)
//  - Heartbeat per rilevare e chiudere client zombie
//  - Limite maxClients per evitare overload
import { config } from './config/index.js';
import Client from './core/Client.js';
import { helper, logger } from "./utils/index.js";
import { WebSocketServer } from 'ws';
import TokenManager from './core/TokenManager.js';
import { fetchProxies } from './scripts/fetchProxies.js';
import ProxyRotator from './core/ProxyRotator.js';
import { HttpsProxyAgent } from 'https-proxy-agent';

const manager = new TokenManager();
const proxyRotator = new ProxyRotator([], {
  retryTimeout: config.proxySettings?.retryTimeout ?? 60 * 1000,
});
const server = helper.createServer();
const wss = new WebSocketServer({ server });

// ═══ Statistiche globali ═══
const globalStats = {
  connectedClients: 0,
  totalBotsSpawned: 0,
  startTime: Date.now(),
  proxiesRotated: 0,
  proxyFailures: 0,
};

// Sincronizza il rotator con la lista proxy caricata da helper
const syncProxyRotator = () => proxyRotator.setProxies(helper.proxies);

// helper.getProxy() ora ruota tramite ProxyRotator (round-robin tra proxy sani)
helper.getProxy = function getProxy() {
  if (!config.proxySettings.enableProxy) return undefined;
  const proxy = proxyRotator.getNextProxy();
  if (!proxy) return undefined;
  globalStats.proxiesRotated++;
  const agent = new HttpsProxyAgent(`${config.proxySettings.protocol}://${proxy}`);
  agent.proxyAddress = proxy;
  return agent;
};

// ═══ HTTP handler ═══
server.on('request', (req, res) => {
  // Health check (Render, Railway, Fly.io)
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('XevBots OK');
    return;
  }
  // Endpoint statistiche live
  if (config.stats?.enable && req.url === (config.stats?.path || '/stats')) {
    const uptime = Math.floor((Date.now() - globalStats.startTime) / 1000);
    const payload = JSON.stringify({
      version: '2.0',
      uptime,
      connectedClients: globalStats.connectedClients,
      totalBotsSpawned: globalStats.totalBotsSpawned,
      validTokens: manager.vt?.length ?? 0,
      proxies: helper.proxies.length,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(payload);
    return;
  }
  // Endpoint statistiche proxy
  if (req.url === '/proxy-stats') {
    const payload = JSON.stringify({
      enabled: !!config.proxySettings.enableProxy,
      proxiesRotated: globalStats.proxiesRotated,
      proxyFailures: globalStats.proxyFailures,
      ...proxyRotator.getStats(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(payload);
    return;
  }
  res.writeHead(404);
  res.end();
});

// ═══ WebSocket ═══
wss.on('connection', (ws) => {
  // Limite massimo client
  const maxC = config.serverSettings.maxClients || 500;
  if (globalStats.connectedClients >= maxC) {
    logger.warn(`Max clients (${maxC}) reached, rejecting connection`);
    ws.close(1013, 'Server full');
    return;
  }

  const client = new Client(ws);
  globalStats.connectedClients++;
  logger.info(`Client Connected (${globalStats.connectedClients}/${maxC})`);

  // NOTA: NON inviamo [0xFF][2] qui — il client XevBots originale non capisce
  // messaggi inaspettati dal server e chiude la connessione immediatamente.
  // La versione del server viene comunicata solo tramite log; gli opcode 8/9/11
  // possono essere aggiunti in futuro quando il client è pronto a riceverli.

  const handleDisconnect = () => {
    client.stopBots();
    globalStats.connectedClients = Math.max(0, globalStats.connectedClients - 1);
    logger.warn('Client Disconnected!');
  };

  ws.on('message', (buffer) => {
    try {
      client.handleMessage(buffer);
    } catch (e) {
      logger.warn('Server: corrupted message — dropped');
    }
  });
  ws.on('close', handleDisconnect);
  ws.on('error', handleDisconnect);

  // Heartbeat: chiudi client zombie (nessuna attività per 60s)
  const heartbeatMs = config.serverSettings.heartbeatInterval || 2000;
  const heartbeat = setInterval(() => {
    const idle = Date.now() - client.lastActivity;
    if (idle > 6000) {
      logger.warn(`Client zombie detected (idle ${Math.floor(idle/1000)}s), closing`);
      clearInterval(heartbeat);
      ws.terminate();
    }
  }, heartbeatMs);

  ws.on('close', () => clearInterval(heartbeat));
});

// ═══ Avvio ═══
const port = process.env.PORT || config.serverSettings.port;

// 1. Proxy esistenti subito
helper.setupProxies();
syncProxyRotator();

// 2. Server attivo immediatamente
server.listen(port, () => {
  logger.info(`Server started on port ${port} with ${helper.proxies.length} proxies`);
});

// 3. Fetch proxy fresh in background
fetchProxies({ skipTest: true }).then(count => {
  if (count > 0) {
    helper.setupProxies();
    syncProxyRotator();
  }
  logger.info(`Fetched ${count} fresh proxies`);
}).catch(e => {
  logger.warn(`Proxy fetch failed: ${e.message}`);
});

// 4. Refresh proxy ogni ora
const proxyRefreshInterval = setInterval(() => {
  fetchProxies({ skipTest: true }).then(count => {
    if (count > 0) {
      helper.setupProxies();
      syncProxyRotator();
    }
    logger.info(`Refreshed ${count} proxies`);
  }).catch(e => {
    logger.warn(`Proxy refresh failed: ${e.message}`);
  });
}, 60 * 60 * 1000);

// 5. Verifica token in background (non blocca l'avvio)
manager.checkTokens((count) => {
  logger.info(`TokenManager: ${count} valid token(s) loaded`);
});

// ═══ Graceful Shutdown ═══
let shuttingDown = false;

const gracefulShutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(proxyRefreshInterval);
  proxyRotator.destroy();
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.close(1001, 'Server shutting down');
  });
  wss.close(() => {
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
  setTimeout(() => {
    logger.warn('Force closing after 10s timeout');
    process.exit(1);
  }, 1000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.warn(`Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  logger.warn(`Unhandled Rejection: ${err?.message || String(err)}`);
});

wss.on('error', (err) => {
  logger.warn(`WebSocket server error: ${err.message}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.warn(`Port ${port} is already in use`);
    process.exit(1);
  } else {
    logger.warn(`Server error: ${err.message}`);
  }
});

export { manager, globalStats, proxyRotator };

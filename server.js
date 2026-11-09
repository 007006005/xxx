// server.js — Zero The Legend Backend PRO (Complete & Optimized for Render)
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { config } from './config/index.js';
import Client from './core/Client.js';
import { helper, logger } from "./utils/index.js";
import TokenManager from './core/TokenManager.js';
import { fetchProxies } from './scripts/fetchProxies.js';
import ProxyRotator from './core/ProxyRotator.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import botManagerRouter from './botManager.js';

const manager = new TokenManager();
const proxyRotator = new ProxyRotator([], {
  retryTimeout: config.proxySettings?.retryTimeout ?? 60 * 1000,
});

// ═══ Express App & HTTP Server ═══
const app = express();

app.use(cors());
app.use(express.json());

// Registrazione rotte API
app.use('/api', botManagerRouter);

// Health check essenziale per Render
app.get(['/', '/health'], (req, res) => {
  res.type('text/plain').send('ZeroTheLegend Backend OK');
});

// Statistiche live
if (config.stats?.enable) {
  app.get(config.stats?.path || '/stats', (req, res) => {
    const uptime = Math.floor((Date.now() - globalStats.startTime) / 1000);
    res.json({
      version: '9.9.0',
      uptime,
      connectedClients: globalStats.connectedClients,
      totalBotsSpawned: globalStats.totalBotsSpawned,
      validTokens: manager.vt?.length ?? 0,
      proxies: helper.proxies.length,
    });
  });
}

// Statistiche proxy
app.get('/proxy-stats', (req, res) => {
  res.json({
    enabled: !!config.proxySettings.enableProxy,
    proxiesRotated: globalStats.proxiesRotated,
    proxyFailures: globalStats.proxyFailures,
    ...proxyRotator.getStats(),
  });
});

const port = process.env.PORT || config.serverSettings.port || 3000;
const server = app.listen(port, () => {
  logger.info(`Server started on port ${port} with ${helper.proxies.length} proxies`);
});

const wss = new WebSocketServer({ server });

// ═══ Statistiche globali & Stato condiviso ═══
const globalStats = {
  connectedClients: 0,
  totalBotsSpawned: 0,
  startTime: Date.now(),
  proxiesRotated: 0,
  proxyFailures: 0,
};

let currentBotConfig = {
  isRunning: false,
  botCount: 10,
  agarServer: "wss://agar.io",
  spawnPointActive: false,
  spawnPointX: 0,
  spawnPointY: 0
};

const syncProxyRotator = () => proxyRotator.setProxies(helper.proxies);

helper.getProxy = function getProxy() {
  if (!config.proxySettings.enableProxy) return undefined;
  const proxy = proxyRotator.getNextProxy();
  if (!proxy) return undefined;
  globalStats.proxiesRotated++;
  const agent = new HttpsProxyAgent(`${config.proxySettings.protocol}://${proxy}`);
  agent.proxyAddress = proxy;
  return agent;
};

// ═══ WebSocket Server ═══
wss.on('connection', (ws) => {
  const maxC = config.serverSettings.maxClients || 5000;
  if (globalStats.connectedClients >= maxC) {
    logger.warn(`Max clients (${maxC}) reached, rejecting connection`);
    ws.close(1013, 'Server full');
    return;
  }

  const client = new Client(ws, globalStats);
  ws.activeClient = client;
  globalStats.connectedClients++;
  logger.info(`Client Connected (${globalStats.connectedClients}/${maxC})`);

  if (currentBotConfig.isRunning) {
    client.startBots(currentBotConfig.botCount, currentBotConfig.agarServer);
    globalStats.totalBotsSpawned += currentBotConfig.botCount;
  }

  const handleDisconnect = () => {
    client.stopBots();
    globalStats.connectedClients = Math.max(0, globalStats.connectedClients - 1);
    logger.warn('Client Disconnected!');
  };

  ws.on('message', (buffer) => {
    try {
      client.handleMessage(buffer);
      if (buffer.length > 0 && buffer[0] === 15) {
        client.botAi = true;
      }
    } catch (e) {
      logger.warn(`Server: corrupted message — dropped: ${e.message}`);
    }
  });

  ws.on('close', handleDisconnect);
  ws.on('error', handleDisconnect);

  const heartbeatMs = config.serverSettings.heartbeatInterval || 5000;
  const heartbeat = setInterval(() => {
    const idle = Date.now() - (client.lastActivity || Date.now());
    if (idle > 60000) {
      logger.warn(`Client zombie detected (idle ${Math.floor(idle/1000)}s), closing`);
      clearInterval(heartbeat);
      ws.terminate();
    }
  }, heartbeatMs);

  ws.on('close', () => clearInterval(heartbeat));
});

// ═══ Inizializzazione Proxies & Token ═══
helper.setupProxies();
syncProxyRotator();

fetchProxies({ skipTest: true }).then(count => {
  if (count > 0) {
    helper.setupProxies();
    syncProxyRotator();
  }
  logger.info(`Fetched ${count} fresh proxies`);
}).catch(e => {
  logger.warn(`Proxy fetch failed: ${e.message}`);
});

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
  setTimeout(() => process.exit(1), 8000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { manager, globalStats, proxyRotator };

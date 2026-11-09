// server.js — Zero The Legend Backend PRO (Complete & Optimized for Render)
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

// ═══ Statistiche globali & Stato condiviso ═══
const globalStats = {
  connectedClients: 0,
  totalBotsSpawned: 0,
  startTime: Date.now(),
  proxiesRotated: 0,
  proxyFailures: 0,
};

// Stato globale pilotato dal pannello Tampermonkey
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

// ═══ HTTP handler ═══
server.on('request', (req, res) => {
  // Configurazione CORS per permettere le chiamate dal gioco/Tampermonkey
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
// server.js (modifica la sezione HTTP handler)
server.on('request', (req, res) => {
    // Configurazione CORS per permettere le chiamate dal gioco/Tampermonkey
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health check essenziale per mantenere attivo il servizio su Render
    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ZeroTheLegend Backend OK');
        return;
    }

    // Inserisci qui il nuovo modulo
    if (req.url.startsWith('/api/sync') || req.url.startsWith('/api/status')) {
        const botManager = require('./botManager');
        req.url = req.url.replace(/^\/api\//, '');
        botManager(req, res, () => {});
        return;
    }

    // Endpoint API Config / Stato sincronizzato con il pannello script
    if (req.url.startsWith('/api/config')) {
        // ... (il tuo codice esistente)
    }

    // ... (resto del codice esistente)
    res.writeHead(404);
    res.end();
});

  // Health check essenziale per mantenere attivo il servizio su Render
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ZeroTheLegend Backend OK');
    return;
  }
  
  // Endpoint API Config / Stato sincronizzato con il pannello script
  if (req.url.startsWith('/api/config')) {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          currentBotConfig = { ...currentBotConfig, ...data };
          
          // Aggiorna lo stato dei client/bot attivi in base alla richiesta POST
          wss.clients.forEach(ws => {
            if (ws.activeClient) {
              if (currentBotConfig.isRunning) {
                if (ws.activeClient.minions.length === 0) {
                  ws.activeClient.startBots(currentBotConfig.botCount, currentBotConfig.agarServer);
                  globalStats.totalBotsSpawned += currentBotConfig.botCount;
                }
              } else {
                ws.activeClient.stopBots();
              }
            }
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, config: currentBotConfig }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    } else {
      // Metodo GET: restituisce lo stato attuale al frontend
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        isRunning: currentBotConfig.isRunning,
        botCount: currentBotConfig.botCount,
        agarServer: currentBotConfig.agarServer,
        ...currentBotConfig
      }));
      return;
    }
  }

  // Endpoint statistiche live
  if (config.stats?.enable && req.url === (config.stats?.path || '/stats')) {
    const uptime = Math.floor((Date.now() - globalStats.startTime) / 1000);
    const payload = JSON.stringify({
      version: '9.9.0',
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

// ═══ WebSocket Server ═══
wss.on('connection', (ws) => {
  const maxC = config.serverSettings.maxClients || 500;
  if (globalStats.connectedClients >= maxC) {
    logger.warn(`Max clients (${maxC}) reached, rejecting connection`);
    ws.close(1013, 'Server full');
    return;
  }

  const client = new Client(ws, globalStats);
  ws.activeClient = client; // Collega il client al socket per riferimenti rapidi
  globalStats.connectedClients++;
  logger.info(`Client Connected (${globalStats.connectedClients}/${maxC})`);

  // Se il server rileva che globalmente i bot sono impostati su running, avviali subito
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
      // Aggiorna l'istanza con le coordinate ricevute dal mouse/script
      client.handleMessage(buffer);
      // Se il client invia la configurazione AI dal pannello, aggiornala
      if (buffer.length > 0 && buffer[0] === 15) { // Esempio opzionale se gestisci flag personalizzati
        client.botAi = true;
      }
    } catch (e) {
      logger.warn(`Server: corrupted message — dropped: ${e.message}`);
    }
  });

  ws.on('close', handleDisconnect);
  ws.on('error', handleDisconnect);

  // Heartbeat per individuare ed eliminare client zombie
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

// ═══ Avvio Server ═══
const port = process.env.PORT || config.serverSettings.port;

helper.setupProxies();
syncProxyRotator();

server.listen(port, () => {
  logger.info(`Server started on port ${port} with ${helper.proxies.length} proxies`);
});

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
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { manager, globalStats, proxyRotator };

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

// Inizializza le variabili
const manager = new TokenManager();
const proxyRotator = new ProxyRotator([], {
  retryTimeout: config.proxySettings?.retryTimeout ?? 60 * 1000,
});
const server = helper.createServer();
const wss = new WebSocketServer({ server });

// Stato globale pilotato dal pannello Tampermonkey
let currentBotConfig = {
  isRunning: false,
  botCount: 10,
  agarServer: "wss://agar.io",
  spawnPointActive: false,
  spawnPointX: 0,
  spawnPointY: 0
};

// Configurazione Express
const app = express();
app.use(cors());
app.use(express.json());

// Inserisci il router del botManager
app.use('/api', require('./botManager'));

// Avvia il server Express
const httpServer = app.listen(process.env.PORT || config.serverSettings.port, () => {
  logger.info(`Server running on port ${process.env.PORT || config.serverSettings.port}`);
});

app.use(cors());
app.use(express.json());

// Lista dei bot gestiti dal server
let bots = [];
let botCount = 10;
let botNames = ["Zero The Legend", "Zero Extens", "Master CNC", "XEVBOTS"];
let agarServer = "wss://agar.io";
let ports = ["", "", "", ""];
let spawnPointActive = false;
let spawnPointX = 0;
let spawnPointY = 0;

// Simula la creazione di un bot
function createBot(idx) {
    return {
        id: idx,
        name: botNames[idx % botNames.length],
        port: ports[idx % ports.length],
        spawnPointActive: spawnPointActive,
        spawnPointX: spawnPointX,
        spawnPointY: spawnPointY,
        isAlive: false
    };
}

// Gestisce la sincronizzazione dei bot
router.post('/api/sync', (req, res) => {
    try {
        const { action, botCount, botName, agarServer, ports, spawnPointActive, spawnPointX, spawnPointY } = req.body;

        if (action === "start") {
            botCount = botCount || botConfig.botCount;
            bots = Array(botCount).fill().map((_, idx) => createBot(idx));
            res.json({ success: true, message: "Bot avviati", bots: bots.length });
        } else if (action === "stop") {
            bots = [];
            res.json({ success: true, message: "Bot fermati" });
        } else if (action === "sync_bots") {
            botCount = botCount || botConfig.botCount;
            botNames = botName ? botName.split(", ").filter(name => name) : botConfig.botNames;
            agarServer = agarServer || botConfig.agarServer;
            ports = ports || botConfig.ports;
            spawnPointActive = spawnPointActive !== undefined ? spawnPointActive : botConfig.spawnPointActive;
            spawnPointX = spawnPointX !== undefined ? parseFloat(spawnPointX) : botConfig.spawnPointX;
            spawnPointY = spawnPointY !== undefined ? parseFloat(spawnPointY) : botConfig.spawnPointY;

            bots = Array(botCount).fill().map((_, idx) => createBot(idx));
            res.json({
                success: true,
                botCount: bots.length,
                botNames: botNames,
                agarServer: agarServer,
                ports: ports,
                spawnPointActive: spawnPointActive,
                spawnPointX: spawnPointX,
                spawnPointY: spawnPointY
            });
        } else {
            res.status(400).json({ error: "Azione non valida" });
        }
    } catch (e) {
        console.error("Errore nel gestire la richiesta:", e);
        res.status(400).json({ error: "Errore interno del server" });
    }
});

// Endpoint per ricevere lo stato sincronizzato
router.get('/api/status', (req, res) => {
    res.json({
        isRunning: bots.length > 0,
        botCount: bots.length,
        agarServer: agarServer,
        spawnPointActive: spawnPointActive,
        spawnPointX: spawnPointX,
        spawnPointY: spawnPointY,
        botNames: botConfig.botNames
    });
});

module.exports = router;

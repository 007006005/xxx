import express from 'express';
import cors from 'cors';

const router = express.Router();

let bots = [];
let botConfig = {
    botCount: 10,
    botNames: ["Zero The Legend", "Zero Extens", "Master CNC", "XEVBOTS"],
    agarServer: "wss://agar.io",
    ports: ["", "", "", ""],
    spawnPointActive: false,
    spawnPointX: 0,
    spawnPointY: 0,
    isRunning: false
};

// Simula la creazione di un bot
function createBot(idx) {
    return {
        id: idx,
        name: botConfig.botNames[idx % botConfig.botNames.length],
        port: botConfig.ports[idx % botConfig.ports.length],
        spawnPointActive: botConfig.spawnPointActive,
        spawnPointX: botConfig.spawnPointX,
        spawnPointY: botConfig.spawnPointY,
        isAlive: false
    };
}

// Gestisce la sincronizzazione dei bot
router.post('/api/sync', (req, res) => {
    try {
        const { action, botCount, botName, agarServer, ports, spawnPointActive, spawnPointX, spawnPointY } = req.body;

        if (action === "start") {
            botConfig.botCount = botCount || botConfig.botCount;
            botConfig.isRunning = true;
            bots = Array(botConfig.botCount).fill().map((_, idx) => createBot(idx));
            res.json({ success: true, message: "Bot avviati", bots: bots.length });
        } else if (action === "stop") {
            botConfig.isRunning = false;
            bots = [];
            res.json({ success: true, message: "Bot fermati" });
        } else if (action === "sync_bots") {
            botConfig.botCount = botCount || botConfig.botCount;
            botConfig.botNames = botName ? botName.split(", ").filter(name => name) : botConfig.botNames;
            botConfig.agarServer = agarServer || botConfig.agarServer;
            botConfig.ports = ports || botConfig.ports;
            botConfig.spawnPointActive = spawnPointActive !== undefined ? spawnPointActive : botConfig.spawnPointActive;
            botConfig.spawnPointX = spawnPointX !== undefined ? parseFloat(spawnPointX) : botConfig.spawnPointX;
            botConfig.spawnPointY = spawnPointY !== undefined ? parseFloat(spawnPointY) : botConfig.spawnPointY;

            bots = Array(botConfig.botCount).fill().map((_, idx) => createBot(idx));
            res.json({
                success: true,
                botCount: bots.length,
                botNames: botConfig.botNames,
                agarServer: botConfig.agarServer,
                ports: botConfig.ports,
                spawnPointActive: botConfig.spawnPointActive,
                spawnPointX: botConfig.spawnPointX,
                spawnPointY: botConfig.spawnPointY
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
        isRunning: botConfig.isRunning,
        botCount: bots.length,
        agarServer: botConfig.agarServer,
        spawnPointActive: botConfig.spawnPointActive,
        spawnPointX: botConfig.spawnPointX,
        spawnPointY: botConfig.spawnPointY,
        botNames: botConfig.botNames
    });
});

module.exports = router;

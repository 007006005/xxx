import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Zero Engine Bot Server is Running\n');
});

const wss = new WebSocketServer({ server });

// Stato globale dei bot e della sessione client
let botState = {
    running: false,
    botCount: 0,
    agarServer: "",
    botOPK: false,
    names: []
};

let mouseCoords = { x: 0, y: 0 };
let activeClients = 0;

wss.on('connection', (ws) => {
    activeClients++;
    console.log(`[INFO] Client Connected (${activeClients} active)`);

    // Invia lo stato iniziale al client connesso
    ws.send(JSON.stringify({ t: 'state', alive: botState.running ? botState.botCount : 0, mass: 0 }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.t) {
                case 'hello':
                    console.log(`[AUTH] Client autenticato - Utente: ${data.user || 'Sconosciuto'}`);
                    break;

                case 'cfg':
                    if (data.cfg) {
                        botState = { ...botState, ...data.cfg };
                        console.log(`[CFG] Stato aggiornato -> Running: ${botState.running}, Bot: ${botState.botCount}, Server: ${botState.agarServer || 'Nessuno'}`);
                        
                        if (botState.running) {
                            // Qui puoi avviare la logica di spawn dei bot verso il server specificato in botState.agarServer
                            console.log(`[BOT ENGINE] Avvio spawn di ${botState.botCount} bot su ${botState.agarServer}`);
                        } else {
                            console.log(`[BOT ENGINE] Arresto bot in corso...`);
                        }
                    }
                    break;

                case 'mouse':
                    if (typeof data.x === 'number' && typeof data.y === 'number') {
                        mouseCoords = { x: data.x, y: data.y };
                        // Aggiorna la posizione dei bot attivi in base alle coordinate del mouse ricevute
                    }
                    break;

                case 'split':
                    console.log(`[COMMAND] Eseguito comando Split per i bot`);
                    break;

                case 'eject':
                    console.log(`[COMMAND] Eseguito comando Feed (Eject) per i bot`);
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ t: 'pong' }));
                    break;

                default:
                    // Comando sconosciuto o custom
                    break;
            }
        } catch (e) {
            console.error("[ERROR] Errore di parsing del messaggio WebSocket:", e);
        }
    });

    // Invia aggiornamenti periodici dello stato dei bot al client
    const statusInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                t: 'state',
                alive: botState.running ? botState.botCount : 0,
                mass: botState.running ? botState.botCount * 150 : 0
            }));
        }
    }, 1000);

    ws.on('close', () => {
        activeClients = Math.max(0, activeClients - 1);
        clearInterval(statusInterval);
        console.log("[WARN] Client Disconnected!");
    });
});

server.listen(PORT, () => {
    console.log(`Zero engine in ascolto sulla porta ${PORT}`);
});

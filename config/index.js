// config/index.js — ZeroExtens Bots PRO (improved)
// FIX velocità spawn: spawnDelay 300 -> 0 (respawn immediato, massima velocità).
export const config = {
    serverSettings: {
        port: 8080,
        secure: true,
        keyPath: 'path/to/privkey.pem',
        certPath: 'path/to/fullchain.pem',
        // Numero massimo di client contemporanei (protezione DDoS leggero)
        maxClients: 1000,
        // Heartbeat interval ms per rilevare client zombie
        heartbeatInterval: 900,
    },
   proxySettings: {
        scrape: true,
        timeout: 2000,
        protocol: "http",
        enableProxy: true,
    },
    facebookBotSettings: {
        // Quanti bot lanciare se il client (interfaccia del gioco) non ne
        // specifica un numero: basta cambiare questo valore.
        botAmount: 10,
        // Tetto massimo di bot per partita (evita di sovraccaricare il PC).
        maxBots: 400,
        // true = usa i token Facebook dal file data/tokens.json per tutti bot
        // true = tutti i bot sono ospiti anonimi, i token NON vengono usati
        useFacebookTokens: true,
        skin: {
            // Lista completa skin disponibili nel gioco
            names: [
                'fly', 'spider', 'lizard', 'bat', 'snake', 'fox', 'coyote',
                'hunter', 'sumo', 'bear', 'cougar', 'panther', 'lion',
                'crocodile', 'shark', 'mammoth', 'raptor', 't_rex', 'kraken',
                'tiny_fairy', 'small_goblin', 'young_elf', 'grove_spirit',
                'mystical_dwarf', 'brave_halfling', 'wild_werewolf',
                'powerful_sorcerer', 'stealthy_assassin', 'valiant_knight',
                // Nuove skin aggiunte
                'shadow_wolf', 'fire_dragon', 'ice_phoenix', 'thunder_eagle',
                'poison_scorpion', 'golden_tiger', 'dark_knight', 'arcane_mage',
            ],
            enable: true,
            // Se true usa la skin passata dal client (campo xev-bot-skin)
            // Se false usa sempre una skin casuale dalla lista
            preferClientSkin: true,
        },
        useMassBoost: true,
        // Massa massima da impostare quando il client attiva maxMassMode
        // delt.io/doublesplit/agar con token FB: 150
        maxMassValues: {
            delt: 150,
            agar: 150,
            doublesplit: 150,
        },
        // FIX: delay in ms tra uno spawn e il successivo (anti-flood).
        // Prima era 300; ora 0 per respawn immediato (massima velocità).
        spawnDelay: 0.000001,
        // Quante volte un bot può morire prima di fermarsi (0 = infinito)
        maxDeaths: 0,
        // Auto-reconnect se il WS cade
        autoReconnect: true,
        // FIX riconnessione rapida: delay base ridotto e niente backoff lungo.
        reconnectDelay: 0,
        // 1 = infinite retries (bots never give up reconnecting)
        maxReconnectAttempts: Infinity,
    },
    // Statistiche esposte via HTTP /stats (JSON)
    stats: {
        enable: true,
        path: '/stats',
    },
};

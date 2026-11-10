// ==UserScript==
// @name         Zero The Legend & ZeroExtens PRO - Bot OPK & Speed Hack (v6.28 LICENZA)
// @version      6.28
// @description  Script completo con Full Map, Menu Dragable corretto, Nomi bot modificabili, Speed Hack e Keybinds.
// @namespace    https://master-elettroerosioni.it/
// @icon         https://master-elettroerosioni.it/favicon.ico
// @match        *://agar.io/*
// @match        *://www.agar.io/*
// @match        *://delt.io/*
// @match        *://*.delt.io/*
// @match        *://deltav4.gitlab.io/*
// @match        *://agar.master-elettroerosioni.it/*
// @match        *://*.agar.master-elettroerosioni.it/*
// @match        *://agar.cc/*
// @match        *://*.agar.cc/*
// @match        *://agar.su/*
// @match        *://*.agar.su/*
// @match        *://agar2.com/*
// @match        *://*.agar2.com/*
// @run-at       document-end
// @noframes
// @connect      master-elettroerosioni.it
// @grant        none
// @inject-into  page
// @compatible   chrome Tampermonkey / Violentmonkey
// @compatible   firefox Tampermonkey / Violentmonkey / Greasemonkey
// @compatible   edge Tampermonkey / Violentmonkey
// @compatible   opera Tampermonkey / Violentmonkey
// ==/UserScript==

/* ================= LICENSE GATE ================= */
(function () {
    'use strict';
    if (window.__zeroGateLoaded) return;
    window.__zeroGateLoaded = true;

    // >>> CONFIGURA QUI <<<
    const LICENSE_API = "https://master-elettroerosioni.it/api/license_api.php?action=verify";
    const REGISTER_URL = "https://master-elettroerosioni.it/";  // pagina di registrazione
    const RECHECK_MS  = 60 * 1000;       // heartbeat/ricontrollo sessione ogni minuto (serve al vincolo di sessione unica)
    const LS = "zero-auth-v1";
    const PREMIUM_URL = "https://master-elettroerosioni.it/";  // >>> pagina acquisto licenze premium (modifica qui) <<<
    const RENEW_URL   = "https://master-elettroerosioni.it/";  // >>> pagina rinnovo licenza (modifica qui) <<<
    let licenseMaxBots = Infinity;
    const ENGINE_HTTP_URL = "https://xxx-6j2x.onrender.com";
    const ENGINE_WS_URL = "wss://xxx-6j2x.onrender.com/ws";
    let engineAccessToken = null;
    let engineTokenRefreshTimer = null;

    const __zeroMain = function () {
        'use strict';

        if (window.__scarzBotsLoaded) return;
        window.__scarzBotsLoaded = true;

        let lastPanelState = null;
        let isSyncingToServer = false;
        let engineSocket = null;
        let engineReconnectTimer = null;
        let remoteBotCount = 0;

        const memStore = new Map(); // fallback se localStorage è bloccato (Firefox/Edge strict, modalità privata)
        const storage = {
            get(key, fallback = null) {
                try {
                    const v = localStorage.getItem(key);
                    if (v !== null) return v;
                } catch (e) {}
                return memStore.has(key) ? memStore.get(key) : fallback;
            },
            set(key, value) {
                memStore.set(key, String(value));
                try { localStorage.setItem(key, value); } catch (e) {}
            }
        };

        // costanti WebSocket e controllo ArrayBuffer indipendenti dal realm / da altri script che sostituiscono WebSocket
        const WS_CONNECTING = 0, WS_OPEN = 1;
        const isArrayBuffer = (d) => Object.prototype.toString.call(d) === "[object ArrayBuffer]";

        const botConfig = {
            botAi: false,
            vShield: false,
            freezeBots: false,
            patrolMode: false,
            botOPK: storage.get("gx-opk-active") === "true",
            tricksplitActive: false,
            clonePlayerName: false,
            targetPlayerName: "",
            spawnPointActive: storage.get("gx-spawn-active") === "true",
            spawnPointX: parseFloat(storage.get("gx-spawn-x")) || 0,
            spawnPointY: parseFloat(storage.get("gx-spawn-y")) || 0,
            spawnMass: 150,
            keybinds: {
                startKey: "1",
                stopKey: "2",
                opkKey: "O",
                modeKey: "F",
                feedKey: "C",
                splitKey: "X",
                vShieldKey: "V",
                freezeKey: "T",
                patrolKey: "P",
                speedKey: "B"
            },
            cords: { x: 0, y: 0 },
            botCount: (() => {
                const saved = parseInt(storage.get("gx-bot-qty"));
                const cap = Math.min(200, licenseMaxBots);
                return saved ? Math.min(cap, Math.max(1, saved)) : Math.min(40, cap);
            })(),
            agarServer: storage.get("gx-agar-server") || "",
            names: [
                storage.get("gx-bot-name-1") || "ZeroTheLegend",
                storage.get("gx-bot-name-2") || "ZeroTheLegend",
                storage.get("gx-bot-name-3") || "ZeroTheLegend",
                storage.get("gx-bot-name-4") || "ZeroTheLegend"
            ],
            ports: [
                storage.get("gx-port-1") || "",
                storage.get("gx-port-2") || "",
                storage.get("gx-port-3") || "",
                storage.get("gx-port-4") || ""
            ],
            stoppedBots: true,
            startedBots: false
        };

        function getBotNameForIndex(idx) {
            const arr = botConfig.names;
            return arr[idx % arr.length] || "ZeroTheLegend";
        }

        async function pushStateToServer(extraData = {}) {
            if (isSyncingToServer) return null;
            if (!engineAccessToken) { showNotice("Backend Render non autenticato", 3000); return null; }
            isSyncingToServer = true;
            try {
                const response = await getFetch()(`${ENGINE_HTTP_URL}/api/sync`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${engineAccessToken}` },
                    body: JSON.stringify({
                        isRunning: botConfig.startedBots, botCount: botConfig.botCount,
                        botName: botConfig.names.join(", "), agarServer: botConfig.agarServer,
                        ports: botConfig.ports, spawnPointActive: botConfig.spawnPointActive,
                        spawnPointX: botConfig.spawnPointX, spawnPointY: botConfig.spawnPointY,
                        spawnMass: botConfig.spawnMass, botOPK: botConfig.botOPK,
                        botAi: botConfig.botAi, vShield: botConfig.vShield,
                        freezeBots: botConfig.freezeBots, patrolMode: botConfig.patrolMode,
                        tricksplitActive: botConfig.tricksplitActive, ...extraData
                    })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.success === false) throw new Error(data.error || data.message || `HTTP ${response.status}`);
                if (typeof data.botCount === "number") remoteBotCount = data.botCount;
                return data;
            } catch (error) {
                showNotice("Render: " + (error.message || "connessione non riuscita"), 3500);
                return null;
            } finally { isSyncingToServer = false; }
        }

        function connectEngineSocket() {
            if (!engineAccessToken || (engineSocket && engineSocket.readyState < 2)) return;
            try {
                const ws = new WebSocket(ENGINE_WS_URL);
                engineSocket = ws;
                ws.binaryType = "arraybuffer";
                ws.onopen = () => { try { ws.send(JSON.stringify({ type: "auth", token: engineAccessToken })); } catch (e) {} };
                ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(String(event.data || "{}"));
                        if (message.status && (message.type === "ready" || message.type === "status")) remoteBotCount = Number(message.status.botCount) || 0;
                    } catch (e) {}
                };
                ws.onclose = () => {
                    if (engineSocket === ws) engineSocket = null;
                    if (engineReconnectTimer) clearTimeout(engineReconnectTimer);
                    if (engineAccessToken) engineReconnectTimer = setTimeout(connectEngineSocket, 3000);
                };
                ws.onerror = () => { try { ws.close(); } catch (e) {} };
            } catch (e) {
                if (engineAccessToken) engineReconnectTimer = setTimeout(connectEngineSocket, 4000);
            }
        }

        function sendEngineTarget() {
            if (!botConfig.startedBots || !engineSocket || engineSocket.readyState !== 1) return;
            try {
                updateMouseWorld();
                const packet = new ArrayBuffer(9), view = new DataView(packet);
                view.setUint8(0, 16);
                view.setInt32(1, Math.round(botConfig.cords.x || 0), true);
                view.setInt32(5, Math.round(botConfig.cords.y || 0), true);
                engineSocket.send(packet);
            } catch (e) {}
        }

        async function engineCommand(command) {
            if (!engineAccessToken) { showNotice("Backend Render non autenticato", 2500); return null; }
            try {
                const response = await getFetch()(`${ENGINE_HTTP_URL}/api/command`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${engineAccessToken}` },
                    body: JSON.stringify({ command })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.success === false) throw new Error(data.error || `HTTP ${response.status}`);
                return data;
            } catch (error) { showNotice("Comando Render: " + (error.message || "errore"), 3000); return null; }
        }

        async function syncWithEngine() {
            if (!engineAccessToken) return;
            try {
                const response = await getFetch()(`${ENGINE_HTTP_URL}/api/status?t=${Date.now()}`, {
                    headers: { "Authorization": `Bearer ${engineAccessToken}` }, mode: "cors"
                });
                if (response.status === 401) { engineAccessToken = null; showNotice("Sessione Render scaduta", 3500); return; }
                if (!response.ok) return;
                const data = await response.json();
                remoteBotCount = Number(data.botCount) || 0;
                if (data.agarServer && data.agarServer !== botConfig.agarServer) {
                    botConfig.agarServer = data.agarServer;
                    storage.set("gx-agar-server", data.agarServer);
                }
                if (typeof data.isRunning === "boolean" && data.isRunning !== lastPanelState) {
                    lastPanelState = data.isRunning;
                    botConfig.startedBots = data.isRunning;
                    botConfig.stoppedBots = !data.isRunning;
                    if (data.isRunning && !startTime) startTime = Date.now();
                    if (!data.isRunning) startTime = null;
                    render();
                }
            } catch (e) {}
        }

        setInterval(syncWithEngine, 3000);
        setInterval(sendEngineTarget, 120);
        window.__zeroConnectEngineSocket = connectEngineSocket;
        connectEngineSocket();

        const SoundFX = {
            ctx: null,
            init() {
                if (!this.ctx) {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    if (AudioCtx) this.ctx = new AudioCtx();
                }
                if (this.ctx && this.ctx.state === 'suspended') {
                    this.ctx.resume();
                }
            },
            playStart() {
                try {
                    this.init();
                    if (!this.ctx) return;
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(261.63, now);
                    osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.15);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.35);
                } catch (e) {}
            },
            playStop() {
                try {
                    this.init();
                    if (!this.ctx) return;
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(523.25, now);
                    osc.frequency.exponentialRampToValueAtTime(261.63, now + 0.15);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.35);
                } catch (e) {}
            }
        };

        // --- SPEED HACK ENGINE ---
        const SpeedHack = {
            active: false,
            multiplier: 1.5,
            toggle() {
                this.active = !this.active;
                showNotice(`SPEED HACK: ${this.active ? 'ON (' + this.multiplier + 'x)' : 'OFF'}`, 1500);
                return this.active;
            },
            patch(ws) {
                if (!ws || ws.__speedPatched) return;
                ws.__speedPatched = true;
                const originalSend = ws.send;
                ws.send = function(data) {
                    if (SpeedHack.active && isArrayBuffer(data) && data.byteLength === 13) {
                        try {
                            const dv = new DataView(data);
                            if (dv.getUint8(0) === 16) {
                                let x = dv.getInt32(1, true);
                                let y = dv.getInt32(5, true);
                                const centerX = window.innerWidth / 2;
                                const centerY = window.innerHeight / 2;
                                let dx = x - centerX;
                                let dy = y - centerY;
                                x = Math.round(centerX + (dx * SpeedHack.multiplier));
                                y = Math.round(centerY + (dy * SpeedHack.multiplier));
                                dv.setInt32(1, x, true);
                                dv.setInt32(5, y, true);
                            }
                        } catch(e) {}
                    }
                    return originalSend.apply(this, arguments);
                };
            }
        };

        class Entity {
            constructor() {
                this.id = 0;
                this.x = 0;
                this.y = 0;
                this.size = 0;
                this.name = "";
                this.isVirus = false;
                this.isPellet = false;
                this.isFriend = false;
            }
        }


        let isStarting = false;
        let isStopping = false;
        let hasRun = false;
        let startTime = null;
        let notice = null;

        function showNotice(text, ms = 3000) {
            notice = { text, until: Date.now() + ms };
            render();
        }

        async function startBots(action) {
            if (isStarting || isStopping) return;
            if (action === "start" && !botConfig.startedBots) {
                if (!engineAccessToken) { showNotice("Attiva la licenza e verifica il collegamento Render", 3500); return; }
                if (!botConfig.agarServer) { showNotice("Entra prima nel server di gioco autorizzato", 3000); return; }
                isStarting = true;
                notice = null;
                botConfig.startedBots = true;
                botConfig.stoppedBots = false;
                hasRun = true;
                startTime = Date.now();
                SoundFX.playStart();
                const result = await pushStateToServer({ action: "start" });
                if (!result || result.success !== true) {
                    botConfig.startedBots = false; botConfig.stoppedBots = true; startTime = null;
                    isStarting = false; render(); return;
                }
                remoteBotCount = Number(result.botCount) || botConfig.botCount;
                connectEngineSocket();
                isStarting = false;
                render();
            } else if (action === "stop" && botConfig.startedBots) {
                isStopping = true;
                notice = null;
                SoundFX.playStop();
                await pushStateToServer({ action: "stop" });
                botConfig.startedBots = false; botConfig.stoppedBots = true;
                botConfig.botAi = false; botConfig.vShield = false; botConfig.freezeBots = false;
                botConfig.patrolMode = false; botConfig.botOPK = false; botConfig.tricksplitActive = false;
                remoteBotCount = 0; startTime = null; isStopping = false; render();
            }
        }

        function updateBotCount() {
            if (botConfig.startedBots) pushStateToServer({ action: "sync_bots" });
        }

        function applyFollowMode() {
            botConfig.followMode = !botConfig.botAi && !botConfig.vShield && !botConfig.freezeBots
                && !botConfig.patrolMode && !botConfig.botOPK;
        }

        function toggleAI() { botConfig.botAi = !botConfig.botAi; applyFollowMode(); render(); pushStateToServer(); }
        function toggleVShield() { botConfig.vShield = !botConfig.vShield; applyFollowMode(); render(); pushStateToServer(); }
        function toggleFreeze() { botConfig.freezeBots = !botConfig.freezeBots; applyFollowMode(); render(); pushStateToServer(); }
        function togglePatrol() { botConfig.patrolMode = !botConfig.patrolMode; applyFollowMode(); render(); pushStateToServer(); }
        function toggleOPK() {
            botConfig.botOPK = !botConfig.botOPK;
            storage.set("gx-opk-active", String(botConfig.botOPK));
            applyFollowMode();
            render();
            pushStateToServer();
        }
        function toggleSpawnPoint() {
            botConfig.spawnPointActive = !botConfig.spawnPointActive;
            storage.set("gx-spawn-active", String(botConfig.spawnPointActive));
            render();
            pushStateToServer();
        }

        function fnSpeedHackToggle() { SpeedHack.toggle(); }

        // --- FULL MAP MODULE ---
        const VIEW_POINTS = [
            { x: -5065.13, y: -5936.68 }, { x: 0.53, y: -5936.29 }, { x: 5065.12, y: 5936.53 }, { x: 5065.93, y: -5936.55 },
            { x: -0.05, y: 5936.20 }, { x: -5065.43, y: -2969.40 }, { x: -5065.30, y: 5936.62 }, { x: -0.17, y: -2968.32 },
            { x: 5065.63, y: 2967.73 }, { x: 5065.75, y: -2968.02 }, { x: -0.19, y: 2967.77 }, { x: -5065.25, y: 0.31 },
            { x: -5065.55, y: 2967.57 }, { x: 0.95, y: 0.31 }, { x: 5065.69, y: 0.30 }, { x: 0, y: 0 }
        ];

        class ViewEnhancer {
            constructor() {
                this.currentMode = 0;
                this.timer = null;
                this.observers = [];
            }
            async setMode(mode) {
                this.currentMode = mode;
                showNotice(`FULL MAP VIEW: ${mode === 0 ? "OFF" : "x" + mode}`, 1500);
                await this.disable();
                if (mode > 0) await this.enable(mode);
            }
            async enable(count) {
                try {
                    for (let i = 0; i < count; i++) {
                        if (window.app && typeof window.app._initSpectate === 'function') window.app._initSpectate();
                        else if (typeof window.initSpectate === 'function') window.initSpectate();
                        await new Promise(r => setTimeout(r, 60));
                    }
                    await new Promise(r => setTimeout(r, 500));
                    let found = [];
                    if (window.app && window.app.clients) {
                        if (Array.isArray(window.app.clients.spectate)) found.push(...window.app.clients.spectate);
                        if (Array.isArray(window.app.clients.render)) found.push(...window.app.clients.render);
                    }
                    this.observers = found.slice(0, count);
                    this.observers.forEach((obs, idx) => {
                        const pt = VIEW_POINTS[idx % VIEW_POINTS.length];
                        if (obs.protocol && typeof obs.protocol.sendSpectate === 'function') obs.protocol.sendSpectate(pt.x, pt.y);
                        else if (typeof obs.sendSpectate === 'function') obs.sendSpectate(pt.x, pt.y);
                    });
                    this.timer = setInterval(() => {
                        this.observers.forEach((obs, idx) => {
                            const pt = VIEW_POINTS[idx % VIEW_POINTS.length];
                            if (obs.protocol && typeof obs.protocol.sendSpectate === 'function') obs.protocol.sendSpectate(pt.x, pt.y);
                            else if (typeof obs.sendSpectate === 'function') obs.sendSpectate(pt.x, pt.y);
                        });
                    }, 400);
                } catch(e) {}
            }
            async disable() {
                if (this.timer) { clearInterval(this.timer); this.timer = null; }
                this.observers.forEach(obs => {
                    try {
                        if (typeof obs.disconnect === 'function') obs.disconnect();
                        else if (obs.protocol && typeof obs.protocol.disconnect === 'function') obs.protocol.disconnect();
                    } catch(e){}
                });
                this.observers = [];
            }
        }
        const viewHelperInstance = new ViewEnhancer();

        function fnFullMapX4() { viewHelperInstance.setMode(4); }
        function fnFullMapX8() { viewHelperInstance.setMode(8); }
        function fnFullMapX16() { viewHelperInstance.setMode(16); }
        function fnFullMapOff() { viewHelperInstance.setMode(0); }

        function fnServerCrash() {
            showNotice("Comando di interruzione server disabilitato", 2500);
        }

        function fnThermalScan() {
            showNotice(`Render Engine: ${remoteBotCount} bot nella sessione`, 1800);
        }

        function fnOverload() {
            showNotice("Comando split inviato al motore Render", 1200);
            engineCommand("split");
        }
        function fnKernelPanic() {
            showNotice("Riconnessione bot richiesta a Render", 1200);
            engineCommand("reconnect");
        }
        function fnRootExploit() {
            showNotice("OPK attivato sul motore Render", 1200);
            botConfig.botOPK = true;
            storage.set("gx-opk-active", "true");
            render();
            pushStateToServer();
        }

        function updateSpectators() {
            try {
                let spectators = [];
                if (window.app && window.app.spectators) spectators = window.app.spectators;
                else if (window.core && window.core.spectators) spectators = window.core.spectators;

                const overlay = document.getElementById('overlays');
                const isOverlayVisible = overlay && window.getComputedStyle(overlay).display !== 'none';
                const isSpectatingMode = window.isSpectating || isOverlayVisible || (window.userScore === 0);

                if (isSpectatingMode && spectators.indexOf("Tu (In Spettatore / Lobby)") === -1) {
                    spectators.unshift("Tu (In Spettatore / Lobby)");
                }

                const specListEl = uiRoot ? uiRoot.getElementById("gx-spectators-list") : null;
                if (specListEl) {
                    specListEl.textContent = spectators.length > 0 ? spectators.join(" | ") : "Tu (In Spettatore / Lobby)";
                }
            } catch(e){}
        }
        setInterval(updateSpectators, 3000);

        function triggerNecroPulse() {
            showNotice("NECRO PULSE ACTIVATED!", 1500);
            if (uiRoot) {
                const overlay = uiRoot.getElementById("gx-necro-overlay");
                if (overlay) {
                    overlay.classList.add("active");
                    setTimeout(() => overlay.classList.remove("active"), 1200);
                }
            }
            engineCommand("split");
            engineCommand("eject");
        }

        function getTotalBotMass() {
            return 0; // metrica di massa non ancora esposta dal backend
        }

        const MOUSE_SCRIPT = `
            (function() {
                if (window.__scarzBots) return;
                let lastMouseX = 0, lastMouseY = 0;
                let worldX = 0, worldY = 0;
                let cameraFound = false;
                let camKey = null;
                let lastScan = 0;
                function camWorld(cam) {
                    if (cam && typeof cam.x === 'number' && typeof cam.y === 'number' && typeof cam.scale === 'number') {
                        if (cam.scale > 0 && cam.scale < 100 && Math.abs(cam.x) < 1000000) {
                            const wx = (lastMouseX - cam.x) / cam.scale;
                            const wy = (lastMouseY - cam.y) / cam.scale;
                            if (Math.abs(wx) < 50000 && Math.abs(wy) < 50000) return { x: wx, y: wy };
                        }
                    }
                    return null;
                }
                function getMouseWorldPosition() {
                    try {
                        if (window.app && window.app.unitManager && window.app.unitManager.activeUnit) {
                            const unit = window.app.unitManager.activeUnit;
                            if (unit.cursor && typeof unit.cursor.x === 'number' && typeof unit.cursor.y === 'number') {
                                return { x: unit.cursor.x, y: unit.cursor.y };
                            }
                        }
                        if (window.app && window.app.mouse) {
                            const mouse = window.app.mouse;
                            if (typeof mouse.x === 'number' && typeof mouse.y === 'number') return { x: mouse.x, y: mouse.y };
                            if (typeof mouse.worldX === 'number' && typeof mouse.worldY === 'number') return { x: mouse.worldX, y: mouse.worldY };
                        }
                        if (window.core && window.core.camera) {
                            const cam = window.core.camera;
                            const wx = (lastMouseX - cam.x) / cam.scale;
                            const wy = (lastMouseY - cam.y) / cam.scale;
                            if (Math.abs(wx) < 50000 && Math.abs(wy) < 50000) return { x: wx, y: wy };
                        }
                        if (camKey) {
                            try {
                                const holder = window[camKey];
                                const p = holder && holder.camera ? camWorld(holder.camera) : null;
                                if (p) return p;
                            } catch (e) {}
                            camKey = null;
                        }
                        const now = Date.now();
                        if (now - lastScan >= 250) {
                            lastScan = now;
                            for (const key in window) {
                                try {
                                    const obj = window[key];
                                    if (obj && typeof obj === 'object' && obj.camera) {
                                        const p = camWorld(obj.camera);
                                        if (p) { camKey = key; return p; }
                                    }
                                } catch (e) {}
                            }
                        }
                        return null;
                    } catch (e) { return null; }
                }
                document.addEventListener('mousemove', function(e) { lastMouseX = e.clientX; lastMouseY = e.clientY; }, true);
                function updatePosition() {
                    try {
                        const pos = getMouseWorldPosition();
                        if (pos) { worldX = pos.x; worldY = pos.y; if (!cameraFound) cameraFound = true; }
                    } catch (e) {}
                    requestAnimationFrame(updatePosition);
                }
                updatePosition();
                window.__scarzBots = {
                    getWorldX: function() { return worldX; },
                    getWorldY: function() { return worldY; },
                    isReady: function() { return cameraFound; },
                    setMouse: function(x, y) { lastMouseX = x; lastMouseY = y; }
                };
            })();
        `;

        let injectAttempts = 0;
        function injectDeltaScript() {
            if (window.__scarzBots || injectAttempts >= 5) return;
            injectAttempts++;
            const script = document.createElement("script");
            try {
                const n = document.querySelector("script[nonce]");
                const nonce = n && (n.nonce || n.getAttribute("nonce"));
                if (nonce) script.setAttribute("nonce", nonce);
            } catch (e) {}
            script.textContent = MOUSE_SCRIPT;
            (document.head || document.documentElement).appendChild(script);
        }

        function getMousePosition() {
            try {
                if (window.__scarzBots) {
                    const x = window.__scarzBots.getWorldX();
                    const y = window.__scarzBots.getWorldY();
                    if (isFinite(x) && isFinite(y) && Math.abs(x) < 50000 && Math.abs(y) < 50000) return { x, y };
                }
            } catch (e) {}
            return { x: botConfig.cords._rawX || window.innerWidth / 2, y: botConfig.cords._rawY || window.innerHeight / 2 };
        }

        function updateMouseWorld() {
            const mp = getMousePosition();
            botConfig.cords.x = mp.x;
            botConfig.cords.y = mp.y;
        }

        const panelId = "gx_panel_" + Math.floor(100 + Math.random() * 900);
        let uiHost = null;
        let uiRoot = null;

        const CSS = `
            *, *::before, *::after { box-sizing: border-box; }
            button, input { font-family: 'Courier New', Courier, monospace, sans-serif; margin: 0; }
            .gx-horror-wrapper {
                position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
                z-index: 2147483647; display: flex; flex-direction: column; align-items: center; pointer-events: auto;
                font-family: 'Courier New', Courier, monospace; width: 420px; max-width: 95vw;
            }
            .gx-horror-toggle {
                background: linear-gradient(135deg, #021a08, #010d04);
                border: 2px solid #00ff66; border-radius: 10px;
                color: #00ff66; padding: 8px 20px; cursor: grab; font-weight: bold; font-size: 13px;
                box-shadow: 0 0 18px rgba(0, 255, 102, 0.4); transition: all 0.3s ease;
                letter-spacing: 2px; text-align: center; width: 100%;
                text-shadow: 0 0 10px rgba(0, 255, 102, 0.9);
                user-select: none;
            }
            .gx-horror-toggle:active {
                cursor: grabbing;
            }
            .gx-horror-toggle:hover {
                background: linear-gradient(135deg, #053312, #021a08); color: #33ff99;
                box-shadow: 0 0 30px rgba(0, 255, 102, 0.8); border-color: #33ff99;
            }
            .gx-horror-panel {
                width: 100%; background: rgba(2, 10, 5, 0.96); border: 2px solid #00ff66;
                border-top: none; border-radius: 0 0 16px 16px; box-shadow: 0 10px 40px rgba(0, 255, 102, 0.35), inset 0 0 25px rgba(0, 50, 20, 0.8);
                padding: 12px; display: flex; flex-direction: column; gap: 8px; backdrop-filter: blur(14px);
                transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
                max-height: 80vh; overflow-y: auto; opacity: 1; transform: translateY(0);
            }
            .gx-horror-panel.collapsed {
                max-height: 0; padding: 0 12px; overflow: hidden; border: none; opacity: 0; transform: translateY(-10px); pointer-events: none;
            }
            .gx-status-wrap { display: flex; flex-direction: column; gap: 6px; border-bottom: 1px dashed rgba(0, 255, 102, 0.4); padding-bottom: 6px; }
            .gx-status-row { display: flex; align-items: center; justify-content: space-between; }
            .gx-brand {
                color: #00ff66; font-size: 12px; font-weight: 900; cursor: pointer;
                text-decoration: none; letter-spacing: 1.5px; text-transform: uppercase;
                text-shadow: 0 0 12px rgba(0,255,102,0.9); transition: all 0.2s ease;
            }
            .gx-brand:hover { color: #66ffb3; text-shadow: 0 0 20px rgba(102,255,179,1); }
            .bot-text { color: #99ccb3; font-size: 11px; font-weight: 700; }
            .status-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
            .status-running { background: #00ff66; box-shadow: 0 0 12px #00ff66; animation: gx-alien-pulse 1.2s infinite; }
            .status-stopped { background: #ffcc00; box-shadow: 0 0 8px #ffcc00; }
            .status-green   { background: #00ff66; box-shadow: 0 0 10px #00ff66; }
            @keyframes gx-alien-pulse { 0%,100% { opacity: 1; transform: scale(1); box-shadow: 0 0 12px #00ff66; } 50% { opacity: 0.5; transform: scale(0.85); box-shadow: 0 0 4px #00ff66; } }
            .stopwatch { color: #00ff66; font-size: 11px; font-weight: 700; display: none; letter-spacing: 1px; text-shadow: 0 0 8px rgba(0,255,102,0.6); }
            .gx-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; border-bottom: 1px dashed rgba(0, 255, 102, 0.4); padding-bottom: 6px; }
            .gx-stat { display: flex; flex-direction: column; align-items: center; background: rgba(5, 25, 12, 0.6); border: 1px solid rgba(0, 255, 102, 0.3); border-radius: 6px; padding: 4px; }
            .gx-stat-label { color: rgba(102, 255, 179, 0.7); font-size: 8px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
            .gx-stat-value { color: #fff; font-size: 11px; font-weight: 900; text-shadow: 0 0 8px rgba(0,255,102,0.7); }
            .gx-controls-grid { display: flex; gap: 6px; }
            .bot-button, .small-button {
                color: #ccffeb; border: 1px solid rgba(0, 255, 102, 0.4); cursor: pointer; border-radius: 6px;
                transition: all 0.2s ease; display: flex; align-items: center; justify-content: center;
                background: rgba(10, 35, 18, 0.5); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700;
                padding: 6px 10px; font-size: 10px; text-shadow: 0 0 6px rgba(0,255,102,0.5); flex: 1;
            }
            .bot-button:hover, .small-button:hover {
                background: rgba(0, 255, 102, 0.25); border-color: #00ff66; color: #fff; box-shadow: 0 0 14px rgba(0, 255, 102, 0.7);
            }
            .bot-button.start-btn { background: rgba(0,255,102,0.15); border-color: rgba(0,255,102,0.5); color: #00ff66; }
            .bot-button.stop-btn { background: rgba(255,26,26,0.2); border-color: rgba(255,26,26,0.6); color: #ff3333; }
            .gx-toggles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
            .small-button.active { background: rgba(0, 255, 102, 0.4); border-color: rgba(0, 255, 102, 0.9); color: #fff; box-shadow: 0 0 12px rgba(0,255,102,0.8); }
            #settings-modal {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(3, 15, 8, 0.98); padding: 18px; border: 2px solid #00ff66; border-radius: 14px;
                color: #ffffff; font-family: 'Courier New', Courier, monospace;
                box-shadow: 0 20px 60px rgba(0,0,0,0.9), 0 0 35px rgba(0,255,102,0.4);
                width: 420px; max-width: calc(100vw - 20px); pointer-events: auto; max-height: 85vh; overflow-y: auto;
            }
            .settings-title { font-size: 14px; font-weight: 900; color: #00ff66; margin-bottom: 12px; text-align: center; letter-spacing: 1.5px; text-transform: uppercase; }
            .settings-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
            .settings-label { margin: 0 0 2px; font-size: 9px; font-weight: 700; color: rgba(153,255,204,0.8); text-transform: uppercase; }
            .settings-input {
                width: 100%; padding: 6px 8px; background: rgba(5, 25, 12, 0.6);
                border: 1px solid rgba(0, 255, 102, 0.4); color: #fff; border-radius: 6px; font-size: 11px;
            }
            .keybind-section { margin-top: 10px; border-top: 1px dashed rgba(0,255,102,0.4); padding-top: 8px; }
            .keybind-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 4px; }
            .keybind-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; background: rgba(5, 20, 10, 0.5); padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(0,255,102,0.2); }
            .keybind-label { color: rgba(179,255,217,0.8); font-size: 9px; font-weight: 700; flex-grow: 1; text-transform: uppercase; }
            .settings-key { padding: 2px 4px; background: rgba(10, 35, 18, 0.8); border: 1px solid rgba(0, 255, 102, 0.5); color: #00ff66; border-radius: 4px; font-size: 10px; font-weight: 800; text-align: center; width: 34px; }
            .settings-save {
                background: linear-gradient(135deg, #053312, #021a08); color: #ccffeb; border: 1px solid #00ff66; padding: 8px;
                cursor: pointer; border-radius: 6px; font-size: 11px; font-weight: 900; text-align: center; width: 100%; margin-top: 12px; text-transform: uppercase;
            }
            .bot-button.necro-btn { background: rgba(0, 128, 64, 0.25); border-color: rgba(0, 255, 102, 0.6); color: #66ffb3; }
            #gx-necro-overlay {
                position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
                box-shadow: inset 0 0 120px rgba(0, 255, 102, 0.6); opacity: 0; transition: opacity 0.4s ease;
            }
            #gx-necro-overlay.active { opacity: 1; }
            .gx-submenu-container.collapsed .gx-submenu-grid { display: none !important; }
            .gx-submenu-header::after { content: '▲'; font-size: 8px; transition: transform 0.2s ease; }
            .gx-submenu-container.collapsed .gx-submenu-header::after { transform: rotate(180deg); }
            .gx-submenu-container {
                display: flex; flex-direction: column; gap: 4px; background: rgba(5, 20, 10, 0.7);
                border: 1px dashed rgba(0, 255, 102, 0.3); border-radius: 8px; padding: 6px;
            }
            .gx-submenu-header {
                color: #33ff99; font-size: 10px; font-weight: 900; text-transform: uppercase;
                display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 4px;
                border-bottom: 1px solid rgba(0, 255, 102, 0.2);
            }
            .gx-submenu-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 4px; }
            .gx-spectate-box {
                background: rgba(3, 12, 6, 0.95); border: 1px solid rgba(0, 255, 102, 0.6); border-radius: 8px;
                padding: 8px; color: #00ff66; font-size: 9px; font-family: 'Courier New', Courier, monospace; max-height: 100px; overflow-y: auto;
                display: flex; flex-direction: column; gap: 4px;
            }
            .gx-spectate-title { font-weight: bold; color: #33ff99; font-size: 10px; text-transform: uppercase; border-bottom: 1px solid rgba(0,255,102,0.4); padding-bottom: 2px; }
            .gx-spec-section { display: flex; flex-direction: column; gap: 2px; }
            .gx-spec-subtitle { color: #66ffb3; font-size: 8px; text-transform: uppercase; font-weight: bold; }
            .gx-spec-content { color: #ffffff; background: rgba(5,25,12,0.7); padding: 2px 4px; border-radius: 4px; border: 1px dashed rgba(0,255,102,0.3); word-break: break-all; }
        `;

        const PANEL_HTML = `
            <div class="gx-horror-wrapper" id="gx-panel">
                <button type="button" class="gx-horror-toggle" id="gx-toggle-btn">☠ ZERO THE LEGEND [MENU] ☠</button>
                <div class="gx-horror-panel collapsed" id="gx-horror-sidebar">
                    <div class="gx-status-wrap">
                        <div class="gx-status-row">
                            <a class="gx-brand" href="https://www.youtube.com/@Scarzbro" target="_blank" rel="noopener noreferrer">ZERO THE LEGEND</a>
                            <span class="status-indicator status-green" id="status-light"></span>
                        </div>
                        <div class="gx-status-row">
                            <span class="bot-text" id="status">Online</span>
                            <span id="stopwatch" class="stopwatch">00:00</span>
                        </div>
                    </div>
                    <div class="gx-stats-grid">
                        <div class="gx-stat"><span class="gx-stat-label">Bots</span><span class="gx-stat-value gx-botCount">40</span></div>
                        <div class="gx-stat"><span class="gx-stat-label">Massa</span><span class="gx-stat-value gx-botMass">0</span></div>
                    </div>
                    <div class="gx-controls-grid">
                        <button type="button" class="bot-button start-btn gx-stfinish">▶ Start [1]</button>
                        <button type="button" class="bot-button stop-btn gx-stop" style="display:none">■ Stop [2]</button>
                    </div>
                    <div class="gx-toggles-grid">
                        <button type="button" class="small-button gx-ai-btn">AI OFF</button>
                        <button type="button" class="small-button gx-vs-btn">VSH OFF</button>
                        <button type="button" class="small-button gx-frz-btn">FRZ OFF</button>
                        <button type="button" class="small-button gx-ptl-btn">PTL OFF</button>
                        <button type="button" class="small-button gx-spawn-btn">SPAWN OFF</button>
                        <button type="button" class="small-button gx-opk-btn">OPK [O]</button>
                    </div>
                    <button type="button" class="bot-button necro-btn gx-necro-btn">☠ NECRO PULSE</button>
                    <div class="gx-spectate-box">
                        <div class="gx-spectate-title">☠ Radar &amp; Spettatori</div>
                        <div class="gx-spec-section">
                            <span class="gx-spec-subtitle">Osservatori</span>
                            <div id="gx-spectators-list" class="gx-spec-content">Nessun osservatore</div>
                        </div>
                    </div>
                    <div class="gx-submenu-container collapsed">
                        <div class="gx-submenu-header">▼ Dark Protocol [3]</div>
                        <div class="gx-submenu-grid">
                            <button type="button" class="small-button gx-sub3-fn1">Overload</button>
                            <button type="button" class="small-button gx-sub3-fn2">Kernel Panic</button>
                            <button type="button" class="small-button gx-sub3-fn3">Speed Hack</button>
                            <button type="button" class="small-button gx-sub3-fn4">Root Exploit</button>
                            <button type="button" class="small-button gx-sub3-fn5" style="color: #ff3333; border-color: rgba(255,51,51,0.5);">Server Crash</button>
                        </div>
                    </div>
                    <div class="gx-submenu-container collapsed">
                        <div class="gx-submenu-header">▼ Eclipse Radar [4]</div>
                        <div class="gx-submenu-grid">
                            <button type="button" class="small-button gx-sub4-fn1">FullMap x4</button>
                            <button type="button" class="small-button gx-sub4-fn2">FullMap x8</button>
                            <button type="button" class="small-button gx-sub4-fn3">FullMap x16</button>
                            <button type="button" class="small-button gx-sub4-fn4" style="color: #ff3333; border-color: rgba(255,51,51,0.5);">FullMap OFF</button>
                            <button type="button" class="small-button gx-sub4-fn5">Thermal Scan</button>
                        </div>
                    </div>
                    <button type="button" class="bot-button cfg-btn" title="Settings">⚙ CONFIGURAZIONE</button>
                </div>
            </div>
        `;

        const SETTINGS_HTML = `
            <div class="settings-title">ZeroTheLegend v6.27 Config</div>
            <div class="settings-grid">
                <div>
                    <div class="settings-label">Bot Amount (1-200)</div>
                    <input type="number" id="gx-bot-qty" class="settings-input" min="1" max="200">
                    <div class="gx-bot-qty-hint" style="font-size:11px;color:#8b93a7;margin-top:-6px;margin-bottom:8px"></div>
                </div>
            </div>
            <div style="margin-top: 6px;">
                <input type="text" id="agarServerInput" class="settings-input" autocomplete="off" placeholder="WebSocket Server URL">
            </div>
            <div style="margin-top: 8px;">
                <div class="settings-label">Nomi Bot (1-4)</div>
                <div class="settings-grid-2" style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-top:4px;">
                    <input type="text" id="gx-bname-1" class="settings-input" placeholder="Bot Name 1">
                    <input type="text" id="gx-bname-2" class="settings-input" placeholder="Bot Name 2">
                    <input type="text" id="gx-bname-3" class="settings-input" placeholder="Bot Name 3">
                    <input type="text" id="gx-bname-4" class="settings-input" placeholder="Bot Name 4">
                </div>
            </div>
            <div class="keybind-section">
                <div class="settings-label">Scorciatoie da Tastiera Modificabili</div>
                <div class="keybind-grid">
                    <div class="keybind-row"><span class="keybind-label">Start Bots</span><input type="text" class="settings-key" id="key-start" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">Stop Bots</span><input type="text" class="settings-key" id="key-stop" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">OPK Toggle</span><input type="text" class="settings-key" id="key-opk" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">AI Mode</span><input type="text" class="settings-key" id="key-mode" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">Speed Hack</span><input type="text" class="settings-key" id="key-speed" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">V-Shield</span><input type="text" class="settings-key" id="key-vshield" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">Freeze</span><input type="text" class="settings-key" id="key-freeze" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">Patrol</span><input type="text" class="settings-key" id="key-patrol" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">Split</span><input type="text" class="settings-key" id="key-split" maxlength="1"></div>
                    <div class="keybind-row"><span class="keybind-label">Feed</span><input type="text" class="settings-key" id="key-feed" maxlength="1"></div>
                </div>
            </div>
            <button type="button" class="settings-save">Salva e Chiudi</button>
        `;

        const $ = (sel) => (uiRoot ? uiRoot.querySelector(sel) : null);
        function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

        function render() {
            if (!uiRoot) return;
            const running = botConfig.startedBots;
            const startBtn = $(".gx-stfinish");
            const stopBtn = $(".gx-stop");
            if (startBtn) startBtn.style.display = running ? "none" : "inline-flex";
            if (stopBtn) stopBtn.style.display = running ? "inline-flex" : "none";

            let alive = remoteBotCount;
            setText($(".gx-botCount"), running ? `${alive}/${botConfig.botCount}` : String(botConfig.botCount));
            setText($(".gx-botMass"), running ? String(getTotalBotMass()) : "0");

            let text, cls;
            if (notice && Date.now() < notice.until) { text = notice.text; cls = "status-stopped"; }
            else if (running) { text = "Running"; cls = "status-running"; }
            else if (hasRun) { text = "Stopped"; cls = "status-stopped"; }
            else { text = "Online"; cls = "status-green"; }
            setText($("#status"), text);
            const light = $("#status-light");
            if (light) {
                const want = "status-indicator " + cls;
                if (light.className !== want) light.className = want;
            }

            const ai = $(".gx-ai-btn");
            if (ai) { setText(ai, `AI ${botConfig.botAi ? "ON" : "OFF"}`); ai.classList.toggle("active", botConfig.botAi); }
            const vs = $(".gx-vs-btn");
            if (vs) { setText(vs, `VSH ${botConfig.vShield ? "ON" : "OFF"}`); vs.classList.toggle("active", botConfig.vShield); }
            const frz = $(".gx-frz-btn");
            if (frz) { setText(frz, `FRZ ${botConfig.freezeBots ? "ON" : "OFF"}`); frz.classList.toggle("active", botConfig.freezeBots); }
            const ptl = $(".gx-ptl-btn");
            if (ptl) { setText(ptl, `PTL ${botConfig.patrolMode ? "ON" : "OFF"}`); ptl.classList.toggle("active", botConfig.patrolMode); }
            const spw = $(".gx-spawn-btn");
            if (spw) { setText(spw, `SPAWN ${botConfig.spawnPointActive ? "ON" : "OFF"}`); spw.classList.toggle("active", botConfig.spawnPointActive); }
            const opk = $(".gx-opk-btn");
            if (opk) { setText(opk, `OPK ${botConfig.botOPK ? "ON" : "OFF"}`); opk.classList.toggle("active", botConfig.botOPK); }
        }

        function buildUI() {
            const host = document.createElement("div");
            host.id = panelId;
            host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;display:block;";
            const root = host.attachShadow({ mode: "open" });
            root.innerHTML = `<style>${CSS}</style>${PANEL_HTML}<div id="gx-necro-overlay"></div>`;

            const toggleBtn = root.getElementById("gx-toggle-btn");
            const sidebar = root.getElementById("gx-horror-sidebar");
            const wrapper = root.querySelector(".gx-horror-wrapper");

            // --- DRAG LOGIC CORRETTA (con listeners globali sicuri) ---
            let isDragging = false;
            let startX = 0, startY = 0;
            let initialX = 0, initialY = 0;

            toggleBtn.addEventListener("mousedown", (e) => {
                if (e.button !== 0) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;

                const rect = wrapper.getBoundingClientRect();
                wrapper.style.left = rect.left + "px";
                wrapper.style.top = rect.top + "px";
                wrapper.style.transform = "none";

                initialX = rect.left;
                initialY = rect.top;
                e.stopPropagation();
            });

            const onMouseMoveDrag = (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                wrapper.style.left = (initialX + dx) + "px";
                wrapper.style.top = (initialY + dy) + "px";
            };

            const onMouseUpDrag = () => {
                isDragging = false;
            };

            window.addEventListener("mousemove", onMouseMoveDrag, true);
            window.addEventListener("mouseup", onMouseUpDrag, true);
            // -----------------------------------------------------------

            if (toggleBtn && sidebar) {
                toggleBtn.addEventListener("click", () => {
                    if (isDragging) return;
                    sidebar.classList.toggle("collapsed");
                    toggleBtn.textContent = sidebar.classList.contains("collapsed") ? "☠ ZERO THE LEGEND [MENU] ☠" : "☠ CHIUDI MENU ☠";
                });
            }

            const on = (sel, type, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener(type, fn); };
            on(".gx-stfinish", "click", () => startBots("start"));
            on(".gx-stop", "click", () => startBots("stop"));
            on(".gx-ai-btn", "click", toggleAI);
            on(".gx-vs-btn", "click", toggleVShield);
            on(".gx-frz-btn", "click", toggleFreeze);
            on(".gx-ptl-btn", "click", togglePatrol);
            on(".gx-spawn-btn", "click", toggleSpawnPoint);
            on(".gx-opk-btn", "click", toggleOPK);
            on(".cfg-btn", "click", toggleSettings);
            on(".gx-necro-btn", "click", triggerNecroPulse);

            on(".gx-sub4-fn1", "click", fnFullMapX4);
            on(".gx-sub4-fn2", "click", fnFullMapX8);
            on(".gx-sub4-fn3", "click", fnFullMapX16);
            on(".gx-sub4-fn4", "click", fnFullMapOff);
            on(".gx-sub4-fn5", "click", fnThermalScan);

            on(".gx-sub3-fn1", "click", fnOverload);
            on(".gx-sub3-fn2", "click", fnKernelPanic);
            on(".gx-sub3-fn3", "click", fnSpeedHackToggle);
            on(".gx-sub3-fn4", "click", fnRootExploit);
            on(".gx-sub3-fn5", "click", fnServerCrash);

            root.querySelectorAll("button").forEach((b) => {
                if (b.id !== "gx-toggle-btn") b.tabIndex = -1;
                b.addEventListener("mousedown", (e) => e.stopPropagation());
            });
            ["mouseup", "dblclick", "contextmenu", "wheel"].forEach((t) => {
                root.addEventListener(t, (e) => e.stopPropagation());
            });

            root.querySelectorAll(".gx-submenu-header").forEach(header => {
                header.addEventListener("click", () => {
                    header.closest(".gx-submenu-container").classList.toggle("collapsed");
                });
            });

            uiHost = host;
            uiRoot = root;
            document.documentElement.appendChild(host);
        }

        function openSettings() {
            if (!uiRoot || $("#settings-modal")) return;
            const modal = document.createElement("div");
            modal.id = "settings-modal";
            modal.innerHTML = SETTINGS_HTML;
            uiRoot.appendChild(modal);

            $("#gx-bot-qty").value = String(botConfig.botCount);
            const qtyEl = $("#gx-bot-qty");
            if (qtyEl) qtyEl.max = String(Math.min(200, licenseMaxBots));
            const qtyHint = $(".gx-bot-qty-hint");
            if (qtyHint) qtyHint.textContent = isFinite(licenseMaxBots) ? (I18N[detectLang()] || I18N.en).trialLimit(licenseMaxBots) : "";
            $("#agarServerInput").value = botConfig.agarServer || "";

            $("#gx-bname-1").value = botConfig.names[0] || "";
            $("#gx-bname-2").value = botConfig.names[1] || "";
            $("#gx-bname-3").value = botConfig.names[2] || "";
            $("#gx-bname-4").value = botConfig.names[3] || "";

            $("#key-start").value = botConfig.keybinds.startKey;
            $("#key-stop").value = botConfig.keybinds.stopKey;
            $("#key-opk").value = botConfig.keybinds.opkKey;
            $("#key-split").value = botConfig.keybinds.splitKey;
            $("#key-feed").value = botConfig.keybinds.feedKey;
            $("#key-mode").value = botConfig.keybinds.modeKey;
            $("#key-speed").value = botConfig.keybinds.speedKey;
            $("#key-vshield").value = botConfig.keybinds.vShieldKey;
            $("#key-freeze").value = botConfig.keybinds.freezeKey;
            $("#key-patrol").value = botConfig.keybinds.patrolKey;

            ["keydown", "keyup", "keypress"].forEach((t) => modal.addEventListener(t, (e) => e.stopPropagation()));
            const save = modal.querySelector(".settings-save");
            save.tabIndex = -1;
            save.addEventListener("click", toggleSettings);
        }

        function saveSettings() {
            const amountEl = $("#gx-bot-qty");
            const serverEl = $("#agarServerInput");
            if (!amountEl) return;

            let amount = parseInt(amountEl.value);
            if (isNaN(amount) || amount < 1) amount = 40;
            if (amount > 200) amount = 200;
            if (amount > licenseMaxBots) {
                amount = licenseMaxBots;
                const t = I18N[detectLang()] || I18N.en;
                showNotice(t.trialLimit(licenseMaxBots), 2500);
            }
            amountEl.value = String(amount);
            storage.set("gx-bot-qty", String(amount));
            botConfig.botCount = amount;

            if (serverEl) {
                const srv = serverEl.value.trim();
                if (srv && !srv.includes("onrender.com")) {
                    botConfig.agarServer = srv;
                    storage.set("gx-agar-server", srv);
                }
            }

            const n1 = $("#gx-bname-1").value.trim() || "ZeroTheLegend";
            const n2 = $("#gx-bname-2").value.trim() || "ZeroTheLegend";
            const n3 = $("#gx-bname-3").value.trim() || "ZeroTheLegend";
            const n4 = $("#gx-bname-4").value.trim() || "ZeroTheLegend";
            botConfig.names = [n1, n2, n3, n4];
            storage.set("gx-bot-name-1", n1);
            storage.set("gx-bot-name-2", n2);
            storage.set("gx-bot-name-3", n3);
            storage.set("gx-bot-name-4", n4);

            const key = (id, fallback) => {
                const el = $(id);
                return (el && el.value.trim().toUpperCase()) || fallback;
            };
            botConfig.keybinds.startKey = key("#key-start", "1");
            botConfig.keybinds.stopKey = key("#key-stop", "2");
            botConfig.keybinds.opkKey = key("#key-opk", "O");
            botConfig.keybinds.splitKey = key("#key-split", "X");
            botConfig.keybinds.feedKey = key("#key-feed", "C");
            botConfig.keybinds.modeKey = key("#key-mode", "F");
            botConfig.keybinds.speedKey = key("#key-speed", "B");
            botConfig.keybinds.vShieldKey = key("#key-vshield", "V");
            botConfig.keybinds.freezeKey = key("#key-freeze", "T");
            botConfig.keybinds.patrolKey = key("#key-patrol", "P");
            storage.set("gx-keybinds", JSON.stringify(botConfig.keybinds));

            updateBotCount();
            render();
            pushStateToServer();
        }

        function toggleSettings() {
            const modal = $("#settings-modal");
            if (modal) {
                saveSettings();
                modal.remove();
            } else {
                openSettings();
            }
        }

        function loadKeybinds() {
            const saved = storage.get("gx-keybinds");
            if (!saved) return;
            try {
                const p = JSON.parse(saved);
                const k = botConfig.keybinds;
                k.startKey = p.startKey || k.startKey;
                k.stopKey = p.stopKey || k.stopKey;
                k.opkKey = p.opkKey || k.opkKey;
                k.modeKey = p.modeKey || k.modeKey;
                k.feedKey = p.feedKey || k.feedKey;
                k.splitKey = p.splitKey || k.splitKey;
                k.vShieldKey = p.vShieldKey || k.vShieldKey;
                k.freezeKey = p.freezeKey || k.freezeKey;
                k.patrolKey = p.patrolKey || k.patrolKey;
                k.speedKey = p.speedKey || k.speedKey;
            } catch (e) {}
        }

        function isTyping(event) {
            const path = typeof event.composedPath === "function" ? event.composedPath() : [];
            const t = path[0] || event.target;
            if (!t || !t.tagName) return false;
            const tag = t.tagName;
            return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
        }

        function matchKey(event, bind) {
            if (!bind) return false;
            const b = bind.toUpperCase();
            if (event.key && event.key.toUpperCase() === b) return true;
            if (event.code === "Key" + b || event.code === "Digit" + b || event.code === "Numpad" + b) return true;
            return false;
        }

        function onKeyDown(event) {
            if (!event.isTrusted || event.isComposing || event.__zeroSeen) return; // ignora tasti simulati da altri script
            try { event.__zeroSeen = true; } catch (e) {}
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (isTyping(event)) return;
            const kb = botConfig.keybinds;

            if (event.key === "F3") { event.preventDefault(); toggleSettings(); return; }

            if (matchKey(event, kb.startKey)) {
                event.preventDefault();
                if (!event.repeat) startBots("start");
            } else if (matchKey(event, kb.stopKey)) {
                event.preventDefault();
                if (!event.repeat) startBots("stop");
            } else if (matchKey(event, kb.opkKey)) {
                event.preventDefault();
                if (!event.repeat) toggleOPK();
            } else if (matchKey(event, kb.modeKey)) {
                event.preventDefault();
                if (!event.repeat) toggleAI();
            } else if (matchKey(event, kb.speedKey)) {
                event.preventDefault();
                if (!event.repeat) SpeedHack.toggle();
            } else if (matchKey(event, kb.vShieldKey)) {
                event.preventDefault();
                if (!event.repeat) toggleVShield();
            } else if (matchKey(event, kb.freezeKey)) {
                event.preventDefault();
                if (!event.repeat) toggleFreeze();
            } else if (matchKey(event, kb.patrolKey)) {
                event.preventDefault();
                if (!event.repeat) togglePatrol();
            } else if (matchKey(event, kb.feedKey)) {
                event.preventDefault();
                if (remoteBotCount > 0 && !botConfig.botAi) engineCommand("eject");
            } else if (matchKey(event, kb.splitKey)) {
                event.preventDefault();
                if (remoteBotCount > 0 && !botConfig.botAi) engineCommand("split");
            }
        }

        function onMouseMove(event) {
            botConfig.cords._rawX = event.clientX;
            botConfig.cords._rawY = event.clientY;
            updateMouseWorld();
            sendEngineTarget();
            try {
                if (window.__scarzBots && window.__scarzBots.setMouse) window.__scarzBots.setMouse(event.clientX, event.clientY);
            } catch (e) {}
        }

        let boundListeners = [];
        function attachGlobalListeners() {
            boundListeners.forEach(([target, type, fn, opts]) => {
                try { target.removeEventListener(type, fn, opts); } catch (e) {}
            });
            boundListeners = [];
            const add = (target, type, fn, opts) => {
                target.addEventListener(type, fn, opts);
                boundListeners.push([target, type, fn, opts]);
            };
            add(window, "keydown", onKeyDown, true);
            add(window, "mousemove", onMouseMove, { capture: true, passive: true });
        }

        function hookWebSocket() {
            const blocked = ["delt.io", "ixagar", "glitch", "socket.io", "firebase", "agartool.io", "herokuapp", "localhost", "onrender.com"];
            const isBlocked = (url) => blocked.some((d) => url.includes(d));
            const proto = WebSocket.prototype;
            const original = proto.send;
            if (original && original.__zeroHook) return; // già agganciato: niente doppio hook
            const hooked = function () {
                if (!this.__scarz) {
                    SpeedHack.patch(this);
                    try {
                        const url = this.url;
                        if (url && !isBlocked(url) && /agar/i.test(url) && url !== botConfig.agarServer) {
                            botConfig.agarServer = url;
                            storage.set("gx-agar-server", url);
                            pushStateToServer();
                        }
                    } catch (e) {}
                }
                return original.apply(this, arguments);
            };
            hooked.__zeroHook = true;
            try { proto.send = hooked; } catch (e) {}
        }

        function ensureUI() {
            if (document.readyState === "loading" || !document.documentElement || !document.body) return;
            if (!window.__scarzBots) injectDeltaScript();
            if (uiHost && uiHost.isConnected) return;
            buildUI();
            attachGlobalListeners();
            render();
        }

        let ensureScheduled = false;
        function scheduleEnsure() {
            if (ensureScheduled) return;
            ensureScheduled = true;
            setTimeout(() => { ensureScheduled = false; ensureUI(); }, 120);
        }

        if (/agar|delt|master-elettroerosioni/i.test(location.hostname)) {
            loadKeybinds();
            hookWebSocket();
            setInterval(updateMouseWorld, 50);
            setInterval(render, 300);
            setInterval(ensureUI, 1000);
            try {
                new MutationObserver(scheduleEnsure).observe(document, { childList: true, subtree: true });
            } catch (e) {}
            ensureUI();
        }
    };

    let started = false;
    function start() {
        if (started) {
            try { window.__zeroConnectEngineSocket?.(); } catch (e) {}
            return;
        }
        started = true;
        try { __zeroMain(); } catch (e) { console.error(e); }
    }

    /* ---------- vincolo browser/sessione: l'IP lo vede solo il server, il client invia device + sessione ---------- */
    let memDev = null;
    function getDeviceId() {
        let id = null;
        try { id = localStorage.getItem("zero-dev-v1"); } catch (e) {}
        id = id || memDev;
        if (!id) {
            try { id = (crypto.randomUUID && crypto.randomUUID()) || null; } catch (e) {}
            if (!id) id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        }
        memDev = id;
        try { localStorage.setItem("zero-dev-v1", id); } catch (e) {}
        return id;
    }
    function getFingerprint() {
        let raw = "";
        try {
            raw = [navigator.userAgent, navigator.platform, navigator.language, screen.width + "x" + screen.height, screen.colorDepth,
                   new Date().getTimezoneOffset(), navigator.hardwareConcurrency || 0].join("|");
        } catch (e) {}
        let h = 5381;
        for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
        return (h >>> 0).toString(16);
    }
    const SESSION_ID = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

    let memAuth = null; // fallback se localStorage non è disponibile
    const saved = () => { try { const v = localStorage.getItem(LS); if (v) return JSON.parse(v); } catch (e) {} return memAuth; };
    const save  = (o) => { memAuth = o; try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} };
    const clear = () => { memAuth = null; try { localStorage.removeItem(LS); } catch (e) {} };

    // fetch "pulito" da un iframe nascosto: agar.io carica script pubblicitari che sostituiscono window.fetch nella pagina
    let cleanFetch = null;
    function getFetch() {
        if (cleanFetch) return cleanFetch;
        try {
            const f = document.createElement("iframe");
            f.setAttribute("data-zero-clean", "1");
            f.style.cssText = "display:none;width:0;height:0;border:0;position:absolute";
            (document.body || document.documentElement).appendChild(f);
            if (f.contentWindow && f.contentWindow.fetch) cleanFetch = f.contentWindow.fetch.bind(f.contentWindow);
        } catch (e) {}
        return cleanFetch || window.fetch.bind(window);
    }

    // WebSocket "pulito" (altri script spesso lo sostituiscono): lo prendiamo dallo stesso iframe nascosto
    function xhrPost(url, body) {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open("POST", url);
            x.setRequestHeader("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
            x.timeout = 15000;
            x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } };
            x.onerror = x.ontimeout = () => reject(new Error("xhr failed"));
            x.send(body);
        });
    }

    // Bridge verso il loader (che usa GM_xmlhttpRequest: niente CORS/CSP). Attivo solo se il loader è installato.
    function bridgeRequest(url, body) {
        return new Promise((resolve, reject) => {
            if (document.documentElement.getAttribute("data-zero-bridge") !== "1") return reject(new Error("no bridge"));
            const id = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            const done = (fn, v) => { clearTimeout(timer); document.removeEventListener("zero-gm-res", onRes); fn(v); };
            const timer = setTimeout(() => done(reject, new Error("bridge timeout")), 15000);
            function onRes(e) {
                let d; try { d = JSON.parse(e.detail); } catch (er) { return; }
                if (!d || d.id !== id) return;
                if (d.error) done(reject, new Error(d.error)); else done(resolve, d.json);
            }
            document.addEventListener("zero-gm-res", onRes);
            document.dispatchEvent(new CustomEvent("zero-gm-req", { detail: JSON.stringify({ id, url, body }) }));
        });
    }

    // POST {key,user} -> {ok, valid, user, type, expires_ts, days_left, token} | {valid:false, reason}
    async function verify(key, user, heartbeat) {
        // form-urlencoded = richiesta "semplice": niente preflight OPTIONS (il PHP la legge da $_POST)
        const body = "key=" + encodeURIComponent(String(key || "").trim().toUpperCase()) + "&user=" + encodeURIComponent(String(user || "").trim())
            + "&device=" + encodeURIComponent(getDeviceId()) + "&sid=" + encodeURIComponent(SESSION_ID) + "&fp=" + encodeURIComponent(getFingerprint()) + (heartbeat ? "&takeover=0" : "&takeover=1");
        try { return await bridgeRequest(LICENSE_API, body); } catch (eb) { /* nessun bridge: canali normali */ }
        try {
            const r = await getFetch()(LICENSE_API, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });
            return await r.json();
        } catch (e1) {
            try {
                return await xhrPost(LICENSE_API, body);
            } catch (e2) {
                try {
                    return await jsonpGet(LICENSE_API + "&" + body); // ultima strada: <script>, non soggetto a CORS
                } catch (e3) {
                    // diagnostica: mostra perché ogni canale è fallito (CORS / CSP della pagina / blocco estensioni)
                    const m = (e) => (e && e.message) ? e.message : String(e);
                    throw new Error("fetch: " + m(e1) + " | xhr: " + m(e2) + " | jsonp(CSP?): " + m(e3));
                }
            }
        }
    }

    // JSONP: il server risponde con callback({...}); la chiave passa nell'URL
    function jsonpGet(url) {
        return new Promise((resolve, reject) => {
            const cb = "__zl_" + Math.random().toString(36).slice(2);
            const el = document.createElement("script");
            let done = false;
            const finish = (fn, v) => {
                if (done) return; done = true;
                try { delete window[cb]; } catch (e) { window[cb] = undefined; }
                el.remove(); clearTimeout(timer); fn(v);
            };
            const timer = setTimeout(() => finish(reject, new Error("jsonp timeout")), 15000);
            window[cb] = (data) => finish(resolve, data);
            el.onerror = () => finish(reject, new Error("jsonp failed"));
            try {
                const n = document.querySelector("script[nonce]");
                const nonce = n && (n.nonce || n.getAttribute("nonce"));
                if (nonce) el.setAttribute("nonce", nonce);
            } catch (e) {}
            el.src = url + "&callback=" + cb;
            (document.head || document.documentElement).appendChild(el);
        });
    }

    const I18N = {
        it: { dir:"ltr", name:"Italiano", title:"Zero The Legend PRO", subtitle:"Inserisci il tuo username e la chiave di licenza per attivare lo script.",
            userPh:"Username del portale", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Attiva", noAccount:"Non hai un account o una licenza?", register:"Registrati",
            fillAll:"Compila tutti i campi.", unreachable:"Server licenze non raggiungibile.", invalid:"Licenza non valida.",
            not_found:"Chiave di licenza non valida.", expired:"Licenza scaduta. Rinnovala dal portale.", wrong_user:"Questa licenza non appartiene a questo utente.",
            revoked:"Licenza revocata dall'amministratore.", sessionExpired:"Sessione scaduta.", licenseExpired:"Licenza scaduta.", noLongerValid:"Licenza non più valida.",
            trialLimit: (n) => `Licenza trial: massimo ${n} bot.` },
        en: { dir:"ltr", name:"English", title:"Zero The Legend PRO", subtitle:"Enter your portal username and your license key to activate the script.",
            userPh:"Portal username", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Activate", noAccount:"Don't have an account or a license?", register:"Register",
            fillAll:"Fill in all fields.", unreachable:"License server unreachable.", invalid:"Invalid license.",
            not_found:"Invalid license key.", expired:"License expired. Renew it from the portal.", wrong_user:"This license does not belong to this user.",
            revoked:"License revoked by the administrator.", sessionExpired:"Session expired.", licenseExpired:"License expired.", noLongerValid:"License no longer valid.",
            trialLimit: (n) => `Trial license: ${n} bots max.` },
        es: { dir:"ltr", name:"Español", title:"Zero The Legend PRO", subtitle:"Introduce tu usuario del portal y tu clave de licencia para activar el script.",
            userPh:"Usuario del portal", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Activar", noAccount:"¿No tienes una cuenta o una licencia?", register:"Regístrate",
            fillAll:"Completa todos los campos.", unreachable:"No se puede contactar con el servidor de licencias.", invalid:"Licencia no válida.",
            not_found:"Clave de licencia no válida.", expired:"Licencia caducada. Renuévala desde el portal.", wrong_user:"Esta licencia no pertenece a este usuario.",
            revoked:"Licencia revocada por el administrador.", sessionExpired:"Sesión caducada.", licenseExpired:"Licencia caducada.", noLongerValid:"La licencia ya no es válida.",
            trialLimit: (n) => `Licencia de prueba: máximo ${n} bots.` },
        fr: { dir:"ltr", name:"Français", title:"Zero The Legend PRO", subtitle:"Saisis ton identifiant du portail et ta clé de licence pour activer le script.",
            userPh:"Identifiant du portail", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Activer", noAccount:"Pas de compte ou de licence ?", register:"S'inscrire",
            fillAll:"Remplis tous les champs.", unreachable:"Serveur de licences injoignable.", invalid:"Licence invalide.",
            not_found:"Clé de licence invalide.", expired:"Licence expirée. Renouvelle-la depuis le portail.", wrong_user:"Cette licence n'appartient pas à cet utilisateur.",
            revoked:"Licence révoquée par l'administrateur.", sessionExpired:"Session expirée.", licenseExpired:"Licence expirée.", noLongerValid:"La licence n'est plus valide.",
            trialLimit: (n) => `Licence d'essai : ${n} bots maximum.` },
        de: { dir:"ltr", name:"Deutsch", title:"Zero The Legend PRO", subtitle:"Gib deinen Portal-Benutzernamen und deinen Lizenzschlüssel ein, um das Skript zu aktivieren.",
            userPh:"Portal-Benutzername", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Aktivieren", noAccount:"Kein Konto oder keine Lizenz?", register:"Registrieren",
            fillAll:"Bitte alle Felder ausfüllen.", unreachable:"Lizenzserver nicht erreichbar.", invalid:"Ungültige Lizenz.",
            not_found:"Ungültiger Lizenzschlüssel.", expired:"Lizenz abgelaufen. Im Portal erneuern.", wrong_user:"Diese Lizenz gehört nicht zu diesem Benutzer.",
            revoked:"Lizenz vom Administrator widerrufen.", sessionExpired:"Sitzung abgelaufen.", licenseExpired:"Lizenz abgelaufen.", noLongerValid:"Lizenz nicht mehr gültig.",
            trialLimit: (n) => `Testlizenz: maximal ${n} Bots.` },
        pt: { dir:"ltr", name:"Português", title:"Zero The Legend PRO", subtitle:"Insira o seu nome de utilizador do portal e a chave de licença para ativar o script.",
            userPh:"Utilizador do portal", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Ativar", noAccount:"Não tem conta ou licença?", register:"Registar",
            fillAll:"Preencha todos os campos.", unreachable:"Servidor de licenças inacessível.", invalid:"Licença inválida.",
            not_found:"Chave de licença inválida.", expired:"Licença expirada. Renove-a no portal.", wrong_user:"Esta licença não pertence a este utilizador.",
            revoked:"Licença revogada pelo administrador.", sessionExpired:"Sessão expirada.", licenseExpired:"Licença expirada.", noLongerValid:"Licença já não é válida.",
            trialLimit: (n) => `Licença de teste: máximo de ${n} bots.` },
        ru: { dir:"ltr", name:"Русский", title:"Zero The Legend PRO", subtitle:"Введите имя пользователя портала и лицензионный ключ, чтобы активировать скрипт.",
            userPh:"Имя пользователя портала", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Активировать", noAccount:"Нет аккаунта или лицензии?", register:"Регистрация",
            fillAll:"Заполните все поля.", unreachable:"Сервер лицензий недоступен.", invalid:"Недействительная лицензия.",
            not_found:"Неверный лицензионный ключ.", expired:"Срок лицензии истёк. Продлите её на портале.", wrong_user:"Эта лицензия не принадлежит этому пользователю.",
            revoked:"Лицензия отозвана администратором.", sessionExpired:"Сессия истекла.", licenseExpired:"Срок лицензии истёк.", noLongerValid:"Лицензия больше не действительна.",
            trialLimit: (n) => `Пробная лицензия: максимум ${n} ботов.` },
        tr: { dir:"ltr", name:"Türkçe", title:"Zero The Legend PRO", subtitle:"Betiği etkinleştirmek için portal kullanıcı adını ve lisans anahtarını gir.",
            userPh:"Portal kullanıcı adı", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Etkinleştir", noAccount:"Hesabın veya lisansın yok mu?", register:"Kayıt ol",
            fillAll:"Tüm alanları doldur.", unreachable:"Lisans sunucusuna ulaşılamıyor.", invalid:"Geçersiz lisans.",
            not_found:"Geçersiz lisans anahtarı.", expired:"Lisans süresi doldu. Portaldan yenile.", wrong_user:"Bu lisans bu kullanıcıya ait değil.",
            revoked:"Lisans yönetici tarafından iptal edildi.", sessionExpired:"Oturum süresi doldu.", licenseExpired:"Lisans süresi doldu.", noLongerValid:"Lisans artık geçerli değil.",
            trialLimit: (n) => `Deneme lisansı: en fazla ${n} bot.` },
        pl: { dir:"ltr", name:"Polski", title:"Zero The Legend PRO", subtitle:"Wpisz nazwę użytkownika portalu i klucz licencyjny, aby aktywować skrypt.",
            userPh:"Nazwa użytkownika portalu", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"Aktywuj", noAccount:"Nie masz konta ani licencji?", register:"Zarejestruj się",
            fillAll:"Wypełnij wszystkie pola.", unreachable:"Serwer licencji niedostępny.", invalid:"Nieprawidłowa licencja.",
            not_found:"Nieprawidłowy klucz licencyjny.", expired:"Licencja wygasła. Odnów ją w portalu.", wrong_user:"Ta licencja nie należy do tego użytkownika.",
            revoked:"Licencja odwołana przez administratora.", sessionExpired:"Sesja wygasła.", licenseExpired:"Licencja wygasła.", noLongerValid:"Licencja już nie jest ważna.",
            trialLimit: (n) => `Licencja próbna: maksymalnie ${n} botów.` },
        ar: { dir:"rtl", name:"العربية", title:"Zero The Legend PRO", subtitle:"أدخل اسم المستخدم الخاص بالبوابة ومفتاح الترخيص لتفعيل السكربت.",
            userPh:"اسم مستخدم البوابة", keyPh:"ZERO-XXXX-XXXX-XXXX-XXXX", btn:"تفعيل", noAccount:"ليس لديك حساب أو ترخيص؟", register:"إنشاء حساب",
            fillAll:"يرجى ملء جميع الحقول.", unreachable:"تعذّر الوصول إلى خادم التراخيص.", invalid:"ترخيص غير صالح.",
            not_found:"مفتاح الترخيص غير صالح.", expired:"انتهت صلاحية الترخيص. جدّده من البوابة.", wrong_user:"هذا الترخيص لا يخص هذا المستخدم.",
            revoked:"تم إلغاء الترخيص من قبل المسؤول.", sessionExpired:"انتهت الجلسة.", licenseExpired:"انتهت صلاحية الترخيص.", noLongerValid:"الترخيص لم يعد صالحًا.",
            trialLimit: (n) => `ترخيص تجريبي: حد أقصى ${n} بوت.` }
    };
    const SUPPORTED_LANGS = Object.keys(I18N);
    function detectLang() {
        const saved = storage_lang_get();
        if (saved && I18N[saved]) return saved;
        const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
        return I18N[nav] ? nav : "en";
    }
    function storage_lang_get() { try { return localStorage.getItem("zero-lang"); } catch (e) { return null; } }
    function storage_lang_set(l) { try { localStorage.setItem("zero-lang", l); } catch (e) {} }

    const BIND_MSG = {
        it: { ip_mismatch:"Licenza vincolata a un altro indirizzo IP.", device_mismatch:"Licenza già attivata su un altro browser/dispositivo.", session_replaced:"Licenza aperta in un'altra sessione: questa è stata chiusa.", session_in_use:"Licenza già in uso in un'altra sessione." },
        en: { ip_mismatch:"License is bound to a different IP address.", device_mismatch:"License is already activated on another browser/device.", session_replaced:"License opened in another session: this one was closed.", session_in_use:"License is already in use in another session." },
        es: { ip_mismatch:"Licencia vinculada a otra dirección IP.", device_mismatch:"Licencia ya activada en otro navegador/dispositivo.", session_replaced:"Licencia abierta en otra sesión: esta se cerró.", session_in_use:"Licencia ya en uso en otra sesión." },
        fr: { ip_mismatch:"Licence liée à une autre adresse IP.", device_mismatch:"Licence déjà activée sur un autre navigateur/appareil.", session_replaced:"Licence ouverte dans une autre session : celle-ci a été fermée.", session_in_use:"Licence déjà utilisée dans une autre session." },
        de: { ip_mismatch:"Lizenz ist an eine andere IP-Adresse gebunden.", device_mismatch:"Lizenz bereits auf einem anderen Browser/Gerät aktiviert.", session_replaced:"Lizenz in einer anderen Sitzung geöffnet: diese wurde beendet.", session_in_use:"Lizenz wird bereits in einer anderen Sitzung verwendet." },
        pt: { ip_mismatch:"Licença vinculada a outro endereço IP.", device_mismatch:"Licença já ativada noutro navegador/dispositivo.", session_replaced:"Licença aberta noutra sessão: esta foi encerrada.", session_in_use:"Licença já em uso noutra sessão." }
    };
    const reasonText = (res, lang) => {
        const t = I18N[lang] || I18N.en;
        const bm = BIND_MSG[lang] || BIND_MSG.en;
        if (res && res.reason && bm[res.reason]) return bm[res.reason];
        if (res && res.reason && t[res.reason]) return t[res.reason];
        return (res && res.error) || t.invalid;
    };

    function lockout(msg) {
        clear();
        alert(msg || (I18N[detectLang()] || I18N.en).noLongerValid);
        location.reload();
    }

    async function recheck() {
        const s = saved();
        const t = I18N[detectLang()] || I18N.en;
        if (!s) return lockout(t.sessionExpired);
        try {
            const res = await verify(s.key, s.user, true); // heartbeat: non prende il controllo di una sessione più recente
            if (!res || !res.valid) return lockout(reasonText(res, detectLang()));
            s.exp = res.expires_ts; s.type = res.type; s.maxBots = res.max_bots; save(s);
            applyLicenseLimit(res);
        } catch (e) {
            // server irraggiungibile: tollerato solo finché la scadenza salvata non è passata
            if (s.exp && Date.now() / 1000 > s.exp) lockout(t.licenseExpired);
        }
    }

    function applyLicenseLimit(res) {
        licenseMaxBots = (res && res.max_bots) ? Number(res.max_bots) : ((res && res.type === "trial") ? 50 : Infinity);
    }

    /* ================= LICENSE TIMER / BUTTONS ================= */
    const LIC_I18N = {
        it: { title:"Licenza", type:"Tipo", left:"Tempo rimasto", expires:"Scade il", unlimited:"Illimitata", expired:"Scaduta", buyPremium:"Acquista Premium", renew:"Rinnova", d:"g" },
        en: { title:"License", type:"Type", left:"Time left", expires:"Expires on", unlimited:"Unlimited", expired:"Expired", buyPremium:"Buy Premium", renew:"Renew", d:"d" },
        es: { title:"Licencia", type:"Tipo", left:"Tiempo restante", expires:"Caduca el", unlimited:"Ilimitada", expired:"Caducada", buyPremium:"Comprar Premium", renew:"Renovar", d:"d" },
        fr: { title:"Licence", type:"Type", left:"Temps restant", expires:"Expire le", unlimited:"Illimitée", expired:"Expirée", buyPremium:"Acheter Premium", renew:"Renouveler", d:"j" },
        de: { title:"Lizenz", type:"Typ", left:"Verbleibend", expires:"Läuft ab am", unlimited:"Unbegrenzt", expired:"Abgelaufen", buyPremium:"Premium kaufen", renew:"Verlängern", d:"T" },
        pt: { title:"Licença", type:"Tipo", left:"Tempo restante", expires:"Expira em", unlimited:"Ilimitada", expired:"Expirada", buyPremium:"Comprar Premium", renew:"Renovar", d:"d" }
    };
    let licBarMounted = false;
    function mountLicenseBar() {
        if (licBarMounted) return;
        licBarMounted = true;
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483646;font-family:system-ui,Arial,sans-serif;";
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = `
        <style>
            .box{width:230px;background:#12141a;border:1px solid #2b3040;border-radius:10px;padding:10px 12px;color:#e8ecf4;box-shadow:0 6px 24px #000a;font-size:12px}
            .hd{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
            .hd b{font-size:13px} .tg{color:#8b93a7;font-size:11px}
            .row{display:flex;justify-content:space-between;gap:8px;margin-top:6px;color:#8b93a7}
            .row span:last-child{color:#e8ecf4;text-align:right}
            .cd{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;margin:8px 0 2px;color:#4ade80}
            .cd.warn{color:#fbbf24} .cd.bad{color:#ff6b6b}
            .btns{display:flex;gap:6px;margin-top:10px}
            .btns a{flex:1;text-align:center;padding:8px 4px;border-radius:7px;font-weight:600;font-size:12px;text-decoration:none;color:#fff}
            .buy{background:#f59e0b} .ren{background:#3b82f6}
            .btns a:hover{filter:brightness(1.12)}
            .body.hide{display:none}
        </style>
        <div class="box">
            <div class="hd" id="hd"><b id="ttl"></b><span class="tg" id="tg">▾</span></div>
            <div class="body" id="body">
                <div class="cd" id="cd">--</div>
                <div class="row"><span id="lType"></span><span id="vType"></span></div>
                <div class="row"><span id="lExp"></span><span id="vExp"></span></div>
                <div class="btns">
                    <a class="buy" id="buy" target="_blank" rel="noopener"></a>
                    <a class="ren" id="ren" target="_blank" rel="noopener"></a>
                </div>
            </div>
        </div>`;
        const $ = (q) => root.querySelector(q);
        const pad = (n) => String(n).padStart(2, "0");
        let collapsed = false;
        $("#hd").onclick = () => {
            collapsed = !collapsed;
            $("#body").classList.toggle("hide", collapsed);
            $("#tg").textContent = collapsed ? "▸" : "▾";
        };
        ["keydown", "keyup", "keypress"].forEach((ev) => root.addEventListener(ev, (e) => e.stopPropagation(), true));
        // trascinabile dall'intestazione (evita sovrapposizioni con la UI di altri script)
        (function () {
            const hd = $("#hd"); let sx, sy, ox, oy, down = false, moved = false;
            hd.addEventListener("pointerdown", (e) => {
                if (e.button !== 0) return;
                const r = host.getBoundingClientRect();
                down = true; moved = false; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
                try { hd.setPointerCapture(e.pointerId); } catch (er) {}
            });
            hd.addEventListener("pointermove", (e) => {
                if (!down) return;
                const dx = e.clientX - sx, dy = e.clientY - sy;
                if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
                moved = true;
                host.style.left = Math.max(0, Math.min(innerWidth - 60, ox + dx)) + "px";
                host.style.top = Math.max(0, Math.min(innerHeight - 40, oy + dy)) + "px";
                host.style.bottom = "auto";
            });
            hd.addEventListener("pointerup", () => { down = false; });
            hd.addEventListener("click", (e) => { if (moved) { e.stopImmediatePropagation(); moved = false; } }, true);
        })();
        function render() {
            if (!host.isConnected) { try { (document.documentElement || document.body).appendChild(host); } catch (e) {} }
            const t = LIC_I18N[detectLang()] || LIC_I18N.en;
            const s = saved() || {};
            $("#ttl").textContent = t.title;
            $("#lType").textContent = t.type;
            $("#lExp").textContent = t.expires;
            $("#vType").textContent = (s.type || "-").toString().toUpperCase();
            $("#buy").textContent = t.buyPremium; $("#buy").href = PREMIUM_URL;
            $("#ren").textContent = t.renew;      $("#ren").href = RENEW_URL;
            const cd = $("#cd");
            if (!s.exp) { cd.textContent = t.unlimited; cd.className = "cd"; $("#vExp").textContent = "-"; return; }
            const expMs = Number(s.exp) * 1000;
            $("#vExp").textContent = new Date(expMs).toLocaleString(detectLang());
            const left = expMs - Date.now();
            if (left <= 0) { cd.textContent = t.expired; cd.className = "cd bad"; return; }
            const sec = Math.floor(left / 1000);
            const dd = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
            cd.textContent = (dd > 0 ? dd + t.d + " " : "") + pad(hh) + ":" + pad(mm) + ":" + pad(ss);
            cd.className = "cd" + (left < 86400000 ? " bad" : left < 3 * 86400000 ? " warn" : "");
        }
        render();
        setInterval(render, 1000);
        (document.documentElement || document.body).appendChild(host);
    }

    async function refreshEngineToken() {
        const auth = saved();
        if (!auth || !auth.key) throw new Error("Chiave licenza non disponibile");
        const response = await getFetch()(`${ENGINE_HTTP_URL}/api/verify-license`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ licenseKey: auth.key })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.valid || !data.token) throw new Error(data.message || "Verifica licenza Render non riuscita");
        engineAccessToken = data.token;
        try { window.__zeroConnectEngineSocket?.(); } catch (e) {}
        auth.engineToken = data.token;
        auth.engineTokenExpiresAt = Date.now() + (Number(data.expiresIn) || 900) * 1000;
        save(auth);
        if (Number(data.maxBots) > 0) licenseMaxBots = Math.min(licenseMaxBots, Number(data.maxBots));
        return data;
    }

    async function afterAuth(res) {
        applyLicenseLimit(res);
        try {
            await refreshEngineToken();
        } catch (error) {
            engineAccessToken = null;
            console.warn("[Zero Render] autenticazione backend non riuscita:", error);
        }
        start();
        mountLicenseBar();
        setInterval(recheck, RECHECK_MS);
        if (engineTokenRefreshTimer) clearInterval(engineTokenRefreshTimer);
        engineTokenRefreshTimer = setInterval(() => {
            refreshEngineToken().catch((error) => console.warn("[Zero Render] rinnovo token:", error));
        }, 10 * 60 * 1000);
    }

    function showLogin(errMsg, lockedLang) {
        let lang = lockedLang || detectLang();
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);font-family:system-ui,Arial,sans-serif;";
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = `
        <style>
            .box{width:320px;background:#12141a;border:1px solid #2b3040;border-radius:12px;padding:22px;color:#e8ecf4;box-shadow:0 10px 40px #000}
            .top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}
            h2{margin:0;font-size:18px} p{margin:0 0 14px;font-size:12px;color:#8b93a7}
            select{background:#0b0d12;color:#e8ecf4;border:1px solid #2b3040;border-radius:6px;font-size:12px;padding:4px 6px}
            input{width:100%;box-sizing:border-box;margin:0 0 10px;padding:10px;border-radius:8px;border:1px solid #2b3040;background:#0b0d12;color:#fff;font-size:14px}
            button{width:100%;padding:10px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
            button:disabled{opacity:.6;cursor:wait} .err{min-height:16px;margin-top:10px;font-size:12px;color:#ff6b6b}
            .reg{margin-top:14px;text-align:center;font-size:12px;color:#8b93a7} .reg a{color:#60a5fa;text-decoration:none;font-weight:600} .reg a:hover{text-decoration:underline}
        </style>
        <div class="box">
            <div class="top"><h2 id="t-title"></h2><select id="lang"></select></div>
            <p id="t-sub"></p>
            <input id="u" autocomplete="username">
            <input id="k" autocomplete="off" spellcheck="false">
            <button id="go"></button>
            <div class="err" id="e"></div>
            <div class="reg" style="margin-top:8px;opacity:.5">build 7</div>
            <div class="reg" id="t-reg"><a id="r" href="#" target="_blank" rel="noopener"></a></div>
        </div>`;
        const $ = (q) => root.querySelector(q);
        const box = $(".box");
        const langSel = $("#lang");
        SUPPORTED_LANGS.forEach((code) => {
            const opt = document.createElement("option");
            opt.value = code; opt.textContent = I18N[code].name;
            langSel.appendChild(opt);
        });
        let currentErrKey = errMsg || "";
        function applyI18N() {
            const t = I18N[lang] || I18N.en;
            box.dir = t.dir;
            langSel.value = lang;
            $("#t-title").textContent = t.title;
            $("#t-sub").textContent = t.subtitle;
            $("#u").placeholder = t.userPh;
            $("#k").placeholder = t.keyPh;
            $("#go").textContent = t.btn;
            $("#t-reg").innerHTML = "";
            $("#t-reg").append(document.createTextNode(t.noAccount + " "));
            const a = document.createElement("a");
            a.id = "r"; a.href = REGISTER_URL; a.target = "_blank"; a.rel = "noopener"; a.textContent = t.register;
            $("#t-reg").appendChild(a);
            $("#e").textContent = currentErrKey;
        }
        langSel.onchange = () => { lang = langSel.value; storage_lang_set(lang); applyI18N(); };
        applyI18N();
        const go = async () => {
            const t = I18N[lang] || I18N.en;
            const username = $("#u").value.trim(), key = $("#k").value.trim().toUpperCase();
            if (!username || !key) { currentErrKey = t.fillAll; $("#e").textContent = currentErrKey; return; }
            $("#go").disabled = true; currentErrKey = ""; $("#e").textContent = "";
            try {
                const res = await verify(key, username);
                if (!res || !res.valid) {
                    currentErrKey = reasonText(res, lang);
                    $("#e").textContent = currentErrKey;
                } else {
                    save({ key, user: res.user, exp: res.expires_ts, type: res.type, maxBots: res.max_bots });
                    stopKeep();
                    host.remove();
                    return afterAuth(res);
                }
            } catch (e) {
                console.warn("[Zero licenza] errore di rete:", e);
                currentErrKey = t.unreachable + (e && e.message ? " [" + e.message + "]" : "");
                $("#e").textContent = currentErrKey;
            }
            $("#go").disabled = false;
        };
        $("#go").onclick = go;
        root.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") go(); }, true);
        root.addEventListener("keyup", (ev) => ev.stopPropagation(), true);
        root.addEventListener("keypress", (ev) => ev.stopPropagation(), true);

        // Alcune pagine (Firefox/agar.io) ripuliscono il DOM e rimuovono i nodi esterni: il pannello viene riagganciato finché non si accede
        let keepTimer = null, keepMO = null;
        const mount = () => {
            if (host.isConnected) return;
            try { (document.documentElement || document.body).appendChild(host); } catch (e) {}
        };
        function stopKeep() {
            clearInterval(keepTimer);
            try { keepMO && keepMO.disconnect(); } catch (e) {}
        }
        mount();
        keepTimer = setInterval(mount, 150);
        try {
            keepMO = new MutationObserver(mount);
            keepMO.observe(document.documentElement, { childList: true });
            if (document.body) keepMO.observe(document.body, { childList: true });
        } catch (e) {}
    }

    (async function boot() {
        if (!/agar|delt|master-elettroerosioni/i.test(location.hostname)) return;
        const s = saved();
        if (s && s.key) {
            try {
                const res = await verify(s.key, s.user);
                if (res && res.valid) { s.exp = res.expires_ts; s.type = res.type; s.maxBots = res.max_bots; save(s); return afterAuth(res); }
                clear();
                return showLogin(reasonText(res, detectLang()));
            } catch (e) {
                return showLogin((I18N[detectLang()] || I18N.en).unreachable);
            }
        }
        showLogin();
    })();
})();
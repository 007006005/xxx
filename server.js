const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT) || 10000;
const LICENSE_API = process.env.LICENSE_API || "https://master-elettroerosioni.it/api/license_api.php?action=verify";
const ENGINE_SECRET = process.env.ENGINE_SECRET || "";
const ALLOW_ANON = process.env.ALLOW_ANON === "1";
const ALLOWED_HOST_RE = new RegExp(process.env.ALLOWED_HOST_RE || "agar", "i");
const MAX_BOTS_PER_SESSION = Number(process.env.MAX_BOTS_PER_SESSION) || 200;
const MAX_BOTS_TOTAL = Number(process.env.MAX_BOTS_TOTAL) || 200;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const WS_CONNECTING = 0, WS_OPEN = 1;
const SERVER_RE = /wss:\/\/([\w.-]+\/[\w-+\/[\d-]+)/;
const sessions = new Set();
const totalBots = () => { let n = 0; for (const s of sessions) n += s.bots.length; return n; };
const isArrayBuffer = (d) => Object.prototype.toString.call(d) === "[object ArrayBuffer]";
const noop = () => {};

/* ---------------- protocollo ---------------- */
class Entity {
    constructor() { this.id = 0; this.x = 0; this.y = 0; this.size = 0; this.name = ""; this.isVirus = false; this.isPellet = false; this.isFriend = false; }
}

class Reader {
    constructor(buffer) { this.dataView = new DataView(buffer); this.byteOffset = 0; this.bufferLength = buffer.byteLength; }
    remaining() { return this.bufferLength - this.byteOffset; }
    readUint8() { if (this.remaining() < 1) return 0; return this.dataView.getUint8(this.byteOffset++); }
    readUint16() { if (this.remaining() < 2) return 0; const v = this.dataView.getUint16(this.byteOffset, true); this.byteOffset += 2; return v; }
    readInt32() { if (this.remaining() < 4) return 0; const v = this.dataView.getInt32(this.byteOffset, true); this.byteOffset += 4; return v; }
    readUint32() { if (this.remaining() < 4) return 0; const v = this.dataView.getUint32(this.byteOffset, true); this.byteOffset += 4; return v; }
    readFloat64() { if (this.remaining() < 8) return 0; const v = this.dataView.getFloat64(this.byteOffset, true); this.byteOffset += 8; return v; }
    readString() {
        let result = "";
        while (this.byteOffset < this.bufferLength) {
            const c = this.dataView.getUint8(this.byteOffset++);
            if (c === 0) break;
            result += String.fromCharCode(c);
        }
        return result;
    }
    readUTF8String() {
        const bytes = [];
        while (this.byteOffset < this.bufferLength) {
            const b = this.dataView.getUint8(this.byteOffset++);
            if (b === 0) break;
            bytes.push(b);
        }
        return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    }
}

class Writer {
    constructor(size) { this.dataView = new DataView(new ArrayBuffer(size || 1000)); this.byteOffset = 0; }
    ensureCapacity(extra) {
        let cap = this.dataView.buffer.byteLength;
        if (this.byteOffset + extra <= cap) return;
        while (this.byteOffset + extra > cap) cap *= 2;
        const grown = new ArrayBuffer(cap);
        new Uint8Array(grown).set(new Uint8Array(this.dataView.buffer));
        this.dataView = new DataView(grown);
    }
    writeUint8(v) { this.ensureCapacity(1); this.dataView.setUint8(this.byteOffset++, v); }
    writeUint32(v) { this.ensureCapacity(4); this.dataView.setUint32(this.byteOffset, v, true); this.byteOffset += 4; }
    writeUTF8String(str) {
        const bytes = new TextEncoder().encode(str);
        this.ensureCapacity(bytes.length + 1);
        for (let i = 0; i < bytes.length; i++) this.dataView.setUint8(this.byteOffset++, bytes[i]);
        this.dataView.setUint8(this.byteOffset++, 0);
    }
    toBuffer() { return this.dataView.buffer.slice(0, this.byteOffset); }
}

/* ---------------- coda di connessione (una per sessione) ---------------- */
class Connector {
    constructor() { this.queue = []; this.active = new Set(); this.timer = null; this.spacing = 40; this.maxInflight = 8; }
    enqueue(bot) {
        if (bot.queued) return;
        bot.queued = true;
        this.queue.push(bot);
        if (!this.timer) this.timer = setInterval(() => this.tick(), this.spacing);
    }
    release(bot) { this.active.delete(bot); }
    remove(bot) {
        this.active.delete(bot);
        if (!bot.queued) return;
        bot.queued = false;
        const i = this.queue.indexOf(bot);
        if (i !== -1) this.queue.splice(i, 1);
    }
    tick() {
        for (const b of this.active) { if (!b.ws || b.ws.readyState !== WS_CONNECTING) this.active.delete(b); }
        if (this.active.size >= this.maxInflight) return;
        const bot = this.queue.shift();
        if (!bot) { clearInterval(this.timer); this.timer = null; return; }
        bot.queued = false;
        this.active.add(bot);
        try { bot.open(); } catch (e) { this.active.delete(bot); }
    }
    destroy() { clearInterval(this.timer); this.timer = null; this.queue.length = 0; this.active.clear(); }
}

/* ---------------- bot ---------------- */
class Bot {
    constructor(session, name, index) {
        this.session = session;
        this.config = session.cfg;
        this.connector = session.connector;
        this.ws = null;
        this.serverUrl = null;
        this.stopped = false;
        this.queued = false;
        this.connected = false;
        this.isAlive = false;
        this.moveInt = null;
        this.connectTimeout = null;
        this.errorTimeout = null;
        this.reconnectTimeout = null;
        this.respawnTimeout = null;
        this.isReconnecting = false;
        this.connectionAttempts = 0;
        this.reconnectBase = 150;
        this.reconnectStep = 150;
        this.reconnectMax = 1500;
        this.connectionTimeout = 5000;
        this.handshakeTimeout = 6000;
        this.spawnRetry = 200;
        this.stallTimeout = 12000;
        this.clientVersion = 31116;
        this.protocolVersion = 23;
        this.biggerPlayerAvoidanceRange = 1.15;
        this.avoidanceDistance = 1;
        this.index = index;
        this.name = name;
        this.resetState();
        this.requestConnect();
    }

    followDefault() { const c = this.config; return c.botAi ? false : (!c.vShield && !c.botOPK); }

    resetState() {
        this.stopMoveLoop();
        this.isAlive = false;
        this.connected = false;
        this.spawnReady = false;
        this.spawnTries = 0;
        this.lastSpawnAt = 0;
        this.lastMessageAt = Date.now();
        this.stateSince = Date.now();
        this.offsetX = 0;
        this.offsetY = 0;
        this.cells = new Map();
        this.pellets = new Map();
        this.pelletCache = null;
        this.ownSet = new Set();
        this.myCellIDs = [];
        this.encryptionKey = 0;
        this.decryptionKey = 0;
        this.serverVersion = null;
        this.followMouse = this.followDefault();
        this.fleeing = false;
    }

    clearTimers() {
        for (const k of ["connectTimeout", "errorTimeout", "reconnectTimeout", "respawnTimeout"]) {
            if (this[k]) { clearTimeout(this[k]); this[k] = null; }
        }
        this.isReconnecting = false;
    }

    detachSocket() {
        this.connector.release(this);
        const ws = this.ws;
        this.ws = null;
        if (ws) {
            ws.removeAllListeners();
            ws.on("error", noop); // evita eccezioni non gestite durante la chiusura
            try { ws.terminate(); } catch (e) {}
        }
    }

    requestConnect() {
        this.clearTimers();
        this.connector.remove(this);
        this.detachSocket();
        this.resetState();
        if (this.stopped || !this.config.startedBots) return;
        this.connector.enqueue(this);
    }

    open() {
        if (this.stopped || !this.config.startedBots) { this.connector.release(this); return; }
        if (!this.config.agarServer) { this.connector.release(this); this.scheduleReconnect(); return; }
        try {
            this.serverUrl = this.config.agarServer;
            const ws = new WebSocket(this.serverUrl, {
                origin: "https://agar.io",
                headers: { "User-Agent": UA },
                handshakeTimeout: this.connectionTimeout,
                perMessageDeflate: false
            });
            ws.binaryType = "arraybuffer";
            ws.on("open", () => this.onopen(ws));
            ws.on("close", (code) => this.onclose(ws, code));
            ws.on("error", () => this.onerror(ws));
            ws.on("message", (data) => this.onmessage(ws, data));
            this.ws = ws;
            this.stateSince = Date.now();
            this.connectionAttempts++;
            this.connectTimeout = setTimeout(() => {
                if (ws.readyState === WS_CONNECTING) { try { ws.terminate(); } catch (e) {} }
            }, this.connectionTimeout);
        } catch (e) {
            this.connector.release(this);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.stopped || !this.config.startedBots || this.isReconnecting) return;
        this.isReconnecting = true;
        const delay = Math.min(this.reconnectBase + this.connectionAttempts * this.reconnectStep, this.reconnectMax) + Math.random() * 300;
        this.reconnectTimeout = setTimeout(() => { this.isReconnecting = false; this.requestConnect(); }, delay);
    }

    recycle() {
        this.clearTimers();
        this.detachSocket();
        this.connected = false;
        this.isAlive = false;
        this.stopMoveLoop();
        this.scheduleReconnect();
    }

    check(now) {
        if (this.stopped || !this.config.startedBots) return;
        const ws = this.ws;
        if (!ws) { if (!this.isReconnecting && !this.queued) this.requestConnect(); return; }
        if (ws.readyState === WS_CONNECTING) { if (now - this.stateSince > this.connectionTimeout + 500) this.recycle(); return; }
        if (ws.readyState !== WS_OPEN) { if (!this.isReconnecting && now - this.stateSince > 1000) this.recycle(); return; }
        if (this.isAlive) { if (now - this.lastMessageAt > this.stallTimeout) this.recycle(); return; }
        if (this.spawnReady) {
            if (now - this.lastSpawnAt > this.spawnRetry) { this.spawnTries++; this.sendSpawn(); }
        } else if (now - this.stateSince > this.handshakeTimeout) {
            this.recycle();
        }
    }

    onopen(ws) {
        if (ws !== this.ws) return;
        this.connector.release(this);
        this.connected = true;
        this.stateSince = Date.now();
        this.lastMessageAt = Date.now();
        this.sendProtocolVersion();
        this.sendClientVersion();
    }

    onclose(ws) {
        if (ws !== this.ws) return;
        this.connector.release(this);
        this.connected = false;
        this.isAlive = false;
        this.stateSince = Date.now();
        this.stopMoveLoop();
        this.scheduleReconnect();
    }

    onerror(ws) {
        if (ws !== this.ws) return;
        this.errorTimeout = setTimeout(() => { try { ws.terminate(); } catch (e) {} }, 200);
    }

    onmessage(ws, data) {
        if (ws !== this.ws) return;
        this.lastMessageAt = Date.now();
        if (!isArrayBuffer(data)) return;
        if (this.decryptionKey) data = this.xorBuffer(data, this.decryptionKey ^ this.clientVersion);
        this.handleBuffer(data);
    }

    send(buffer) {
        const ws = this.ws;
        if (!ws || ws.readyState !== WS_OPEN) return;
        if (this.encryptionKey) {
            buffer = this.xorBuffer(buffer, this.encryptionKey);
            this.encryptionKey = this.rotateKey(this.encryptionKey);
        }
        try { ws.send(buffer); } catch (e) {}
    }

    startMoveLoop() { this.stopMoveLoop(); this.moveInt = setInterval(() => this.move(), 120); }
    stopMoveLoop() { if (this.moveInt) { clearInterval(this.moveInt); this.moveInt = null; } }

    closeSoon() {
        const ws = this.ws;
        setTimeout(() => { try { if (ws) ws.close(); } catch (e) {} }, 200);
    }

    handleBuffer(buffer) {
        try {
            if (!buffer || buffer.byteLength < 1) return;
            const reader = new Reader(buffer);
            const type = reader.readUint8();
            switch (type) {
                case 18:
                    this.cells.clear(); this.pellets.clear(); this.ownSet.clear(); this.myCellIDs.length = 0;
                    this.markDead();
                    break;
                case 85:
                    this.closeSoon();
                    break;
                case 32:
                    if (reader.remaining() >= 4) {
                        const id = reader.readUint32();
                        if (!this.myCellIDs.includes(id)) this.myCellIDs.push(id);
                        this.ownSet.add(id);
                    }
                    if (!this.isAlive) {
                        this.isAlive = true;
                        this.connectionAttempts = 0;
                        this.spawnTries = 0;
                        this.stateSince = Date.now();
                        this.startMoveLoop();
                        if (this.config.spawnPointActive) this.moveTo(this.config.spawnPointX, this.config.spawnPointY);
                    }
                    break;
                case 241:
                    if (reader.remaining() >= 4) {
                        this.decryptionKey = reader.readUint32();
                        this.serverVersion = reader.readString();
                        const match = this.serverUrl && this.serverUrl.match(SERVER_RE);
                        if (match) this.encryptionKey = this.murmur2(match[1] + this.serverVersion, 255);
                    }
                    break;
                case 242:
                    this.spawnReady = true;
                    this.sendSpawn();
                    break;
                case 255:
                    if (reader.remaining() >= 4) {
                        const outSize = reader.readUint32();
                        if (outSize > 0 && outSize <= 8 * 1024 * 1024) {
                            const out = this.uncompressMessage(new Uint8Array(buffer, 5), new Uint8Array(outSize));
                            this.handleMessage(out.buffer);
                        }
                    }
                    break;
            }
        } catch (e) {}
    }

    handleMessage(buffer) {
        try {
            if (!buffer || buffer.byteLength < 1) return;
            const reader = new Reader(buffer);
            const type = reader.readUint8();
            if (type === 16) this.updateNodes(reader);
            else if (type === 64) this.updateOffset(reader);
        } catch (e) {}
    }

    updateOffset(reader) {
        if (reader.remaining() < 32) return;
        const minX = reader.readFloat64(), minY = reader.readFloat64(), maxX = reader.readFloat64(), maxY = reader.readFloat64();
        if (maxX - minX > 14000) this.offsetX = (maxX + minX) / 2;
        if (maxY - minY > 14000) this.offsetY = (maxY + minY) / 2;
    }

    removeCell(id) {
        this.cells.delete(id);
        this.pellets.delete(id);
        this.ownSet.delete(id);
        const i = this.myCellIDs.indexOf(id);
        if (i !== -1) this.myCellIDs.splice(i, 1);
    }

    markDead() {
        if (!this.isAlive) return;
        this.isAlive = false;
        this.spawnTries = 0;
        this.stateSince = Date.now();
        this.stopMoveLoop();
        this.followMouse = this.followDefault();
        this.fleeing = false;
        this.respawnTimeout = setTimeout(() => this.sendSpawn(), 50);
    }

    updateNodes(reader) {
        if (reader.remaining() < 2) return;
        const eatCount = reader.readUint16();
        for (let i = 0; i < eatCount; i++) {
            if (reader.remaining() < 8) return;
            reader.readUint32();
            this.removeCell(reader.readUint32());
        }
        while (reader.remaining() >= 4) {
            const id = reader.readUint32();
            if (id === 0) break;
            if (reader.remaining() < 11) return;
            let entity = this.cells.get(id) || this.pellets.get(id);
            if (!entity) { entity = new Entity(); entity.id = id; }
            entity.x = reader.readInt32();
            entity.y = reader.readInt32();
            entity.size = reader.readUint16();
            const flags = reader.readUint8();
            const extendedFlags = flags & 128 ? reader.readUint8() : 0;
            if (flags & 1) entity.isVirus = true;
            if (flags & 2) { if (reader.remaining() < 3) return; reader.byteOffset += 3; }
            if (flags & 4) reader.readString();
            if (flags & 8) entity.name = reader.readUTF8String();
            if (extendedFlags & 1) entity.isPellet = true;
            if (extendedFlags & 2) entity.isFriend = true;
            if (extendedFlags & 4) { if (reader.remaining() < 4) return; reader.byteOffset += 4; }
            if (entity.isPellet) this.pellets.set(id, entity);
            else this.cells.set(id, entity);
        }
        if (reader.remaining() >= 2) {
            const removed = reader.readUint16();
            for (let i = 0; i < removed && reader.remaining() >= 4; i++) this.removeCell(reader.readUint32());
        }
        if (this.isAlive && this.myCellIDs.length === 0) this.markDead();
    }

    nearestPellet(bot, now) {
        const c = this.pelletCache;
        if (c && now - c.at < 3000) {
            const cached = this.pellets.get(c.id);
            if (cached) return cached;
        }
        let best = null, bestD = Infinity;
        for (const e of this.pellets.values()) {
            if (e.isFriend) continue;
            const dx = e.x - bot.x, dy = e.y - bot.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = e; }
        }
        this.pelletCache = best ? { id: best.id, at: now } : null;
        return best;
    }

    scan(bot, now) {
        const r = { bigger: null, biggerDist: Infinity, smaller: null, smallerDist: Infinity, pellet: null, virus: null, virusDist: Infinity };
        for (const e of this.cells.values()) {
            if (e.isPellet || e.isFriend || this.ownSet.has(e.id)) continue;
            const dx = e.x - bot.x, dy = e.y - bot.y;
            const dist = Math.max(0, Math.sqrt(dx * dx + dy * dy) - (bot.size + e.size));
            if (e.isVirus) {
                if (bot.size > e.size * 1.32 && dist < r.virusDist) { r.virusDist = dist; r.virus = e; }
            } else if (e.name !== this.name) {
                if (e.size > bot.size * this.biggerPlayerAvoidanceRange) {
                    if (dist < r.biggerDist) { r.biggerDist = dist; r.bigger = e; }
                } else if (e.size < bot.size) {
                    if (dist < r.smallerDist) { r.smallerDist = dist; r.smaller = e; }
                }
            }
        }
        r.pellet = this.nearestPellet(bot, now);
        return r;
    }

    steerAway(bot, e) { this.moveTo(bot.x + (bot.x - e.x), bot.y + (bot.y - e.y)); }

    shouldFlee(enemy, dist, enterRange) {
        if (!enemy) { this.fleeing = false; return false; }
        if (this.fleeing) {
            if (dist > enterRange * 1.5) { this.fleeing = false; return false; }
            return true;
        }
        if (dist < enterRange) { this.fleeing = true; return true; }
        return false;
    }

    randomMove(bot) {
        const rx = Math.floor(1337 * Math.random());
        const ry = Math.floor(1337 * Math.random());
        this.moveTo(bot.x + (Math.random() > 0.5 ? rx : -rx), bot.y + (Math.random() > 0.5 ? -ry : ry));
    }

    farm(bot, s) {
        if (s.pellet) this.moveTo(s.pellet.x, s.pellet.y);
        else this.randomMove(bot);
    }

    move() {
        if (!this.isAlive || this.myCellIDs.length === 0) return;
        let sx = 0, sy = 0, n = 0, size = 0, maxCell = 0;
        for (const id of this.myCellIDs) {
            const c = this.cells.get(id);
            if (!c) continue;
            sx += c.x; sy += c.y; size += c.size; n++;
            if (c.size > maxCell) maxCell = c.size;
        }
        if (!n) return;
        const bot = { x: sx / n, y: sy / n, size };
        const cfg = this.config;
        const cords = cfg.cords;

        if (cfg.spawnPointActive) { this.moveTo(cfg.spawnPointX, cfg.spawnPointY); return; }

        if (cfg.botOPK) {
            this.fleeing = false;
            const currentMass = (bot.size * bot.size) / 100;
            const hasReachedMassLimit = currentMass >= 150;
            let targetCell = null, minDist = Infinity;
            const isOurBot = (name) => name ? cfg.names.includes(name.trim()) : false;
            for (const e of this.cells.values()) {
                if (e.isPellet || e.isFriend || this.ownSet.has(e.id) || e.isVirus) continue;
                if (isOurBot(e.name)) {
                    const targetMass = (e.size * e.size) / 100;
                    if (targetMass >= 150 && currentMass >= 150) continue;
                    const dx = e.x - bot.x, dy = e.y - bot.y;
                    const dist = dx * dx + dy * dy;
                    if (dist < minDist) { minDist = dist; targetCell = e; }
                }
            }
            if (targetCell && !hasReachedMassLimit) {
                this.moveTo(targetCell.x, targetCell.y);
            } else {
                const pellet = this.nearestPellet(bot, Date.now());
                if (pellet) this.moveTo(pellet.x, pellet.y);
                else this.randomMove(bot);
            }
            return;
        }

        if (cfg.tricksplitActive) {
            this.fleeing = false;
            this.moveTo(cords.x + this.offsetX, cords.y + this.offsetY);
            this.split();
            this.eject();
            return;
        }

        if (cfg.patrolMode) {
            this.fleeing = false;
            const angle = (Date.now() / 600) + (this.index * (Math.PI * 2 / Math.max(1, this.session.bots.length)));
            const radius = 350;
            this.moveTo((cords.x + this.offsetX) + Math.cos(angle) * radius, (cords.y + this.offsetY) + Math.sin(angle) * radius);
            return;
        }

        if (cfg.freezeBots) { this.moveTo(bot.x, bot.y); return; }

        const s = this.scan(bot, Date.now());
        const detectionRange2 = bot.size * 1.2;

        if (cfg.vShield && s.virus && (maxCell * maxCell) / 100 >= 132) {
            this.fleeing = false;
            this.moveTo(s.virus.x, s.virus.y);
            return;
        }

        if (this.followMouse) {
            this.fleeing = false;
            this.moveTo(cords.x + this.offsetX, cords.y + this.offsetY);
        } else if (this.myCellIDs.length > 1) {
            this.farm(bot, s);
        } else if (this.shouldFlee(s.bigger, s.biggerDist, this.avoidanceDistance + detectionRange2)) {
            this.steerAway(bot, s.bigger);
        } else if (s.smaller && s.smaller.size <= bot.size * 0.83) {
            this.moveTo(s.smaller.x, s.smaller.y);
        } else {
            this.farm(bot, s);
        }
    }

    sendProtocolVersion() {
        const ws = this.ws;
        if (!ws || ws.readyState !== WS_OPEN) return;
        const w = new Writer(5);
        w.writeUint8(254);
        w.writeUint32(this.protocolVersion);
        ws.send(w.toBuffer());
    }

    sendClientVersion() {
        const ws = this.ws;
        if (!ws || ws.readyState !== WS_OPEN) return;
        const w = new Writer(5);
        w.writeUint8(255);
        w.writeUint32(this.clientVersion);
        ws.send(w.toBuffer());
    }

    sendSpawn() {
        this.lastSpawnAt = Date.now();
        let finalName = this.name;
        if (this.config.clonePlayerName && this.config.targetPlayerName) finalName = this.config.targetPlayerName;
        const w = new Writer(finalName.length * 4 + 2);
        w.writeUint8(0);
        w.writeUTF8String(finalName);
        this.send(w.toBuffer());
    }

    moveTo(x, y) {
        const buf = new ArrayBuffer(13);
        const dv = new DataView(buf);
        dv.setUint8(0, 16);
        dv.setInt32(1, Number.isFinite(x) ? Math.round(x) : 0, true);
        dv.setInt32(5, Number.isFinite(y) ? Math.round(y) : 0, true);
        dv.setUint32(9, this.decryptionKey, true);
        this.send(buf);
    }

    split() { if (this.isAlive) this.send(new Uint8Array([17]).buffer); }
    eject() { if (this.isAlive) this.send(new Uint8Array([21]).buffer); }

    rotateKey(key) {
        key = Math.imul(key, 1540483477) >> 0;
        key = Math.imul(key >>> 24 ^ key, 1540483477) >> 0 ^ 114296087;
        key = Math.imul(key >>> 13 ^ key, 1540483477) >> 0;
        return key >>> 15 ^ key;
    }

    xorBuffer(buffer, key) {
        try {
            const dv = new DataView(buffer);
            for (let i = 0; i < dv.byteLength; i++) dv.setUint8(i, dv.getUint8(i) ^ key >>> i % 4 * 8 & 255);
            return buffer;
        } catch (e) { return buffer; }
    }

    uncompressMessage(compressed, output) {
        try {
            for (let i = 0, j = 0; i < compressed.length;) {
                const token = compressed[i++];
                let literalLength = token >> 4;
                if (literalLength > 0) {
                    let ext = literalLength + 240;
                    for (; ext === 255;) {
                        if (i >= compressed.length) return output;
                        ext = compressed[i++];
                        literalLength += ext;
                    }
                    const end = Math.min(i + literalLength, compressed.length);
                    const n = Math.min(end - i, output.length - j);
                    if (n > 0) output.set(compressed.subarray(i, i + n), j);
                    j += end - i;
                    i = end;
                    if (i === compressed.length) return output;
                }
                if (i + 1 >= compressed.length) return output;
                const offset = compressed[i++] | compressed[i++] << 8;
                if (offset === 0 || offset > j) return output;
                let matchLength = token & 15;
                let ext = matchLength + 240;
                for (; ext === 255;) {
                    if (i >= compressed.length) return output;
                    ext = compressed[i++];
                    matchLength += ext;
                }
                let pos = j - offset;
                const end = Math.min(j + matchLength + 4, output.length);
                for (; j < end;) output[j++] = output[pos++];
            }
            return output;
        } catch (e) { return output; }
    }

    murmur2(str, seed) {
        let length = str.length;
        let h = seed ^ length;
        let i = 0;
        let k;
        while (length >= 4) {
            k = str.charCodeAt(i) & 255 | (str.charCodeAt(++i) & 255) << 8 | (str.charCodeAt(++i) & 255) << 16 | (str.charCodeAt(++i) & 255) << 24;
            k = (k & 65535) * 1540483477 + (((k >>> 16) * 1540483477 & 65535) << 16);
            k ^= k >>> 24;
            k = (k & 65535) * 1540483477 + (((k >>> 16) * 1540483477 & 65535) << 16);
            h = (h & 65535) * 1540483477 + (((h >>> 16) * 1540483477 & 65535) << 16) ^ k;
            length -= 4;
            ++i;
        }
        switch (length) {
            case 3: h ^= (str.charCodeAt(i + 2) & 255) << 16;
            case 2: h ^= (str.charCodeAt(i + 1) & 255) << 8;
            case 1: h ^= str.charCodeAt(i) & 255;
                h = (h & 65535) * 1540483477 + (((h >>> 16) * 1540483477 & 65535) << 16);
        }
        h ^= h >>> 13;
        h = (h & 65535) * 1540483477 + (((h >>> 16) * 1540483477 & 65535) << 16);
        h ^= h >>> 15;
        return h >>> 0;
    }

    stop() {
        this.stopped = true;
        this.connector.remove(this);
        this.clearTimers();
        this.stopMoveLoop();
        this.detachSocket();
        this.connected = false;
        this.isAlive = false;
    }
}

/* ---------------- sessione (un client = un userscript collegato) ---------------- */
const DEFAULT_NAME = "ZeroTheLegend";
const cleanName = (n) => String(n == null ? "" : n).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 15) || DEFAULT_NAME;
const nameFor = (cfg, idx) => cfg.names[idx % cfg.names.length] || DEFAULT_NAME;

function validServer(u) {
    try {
        const s = String(u).trim();
        if (s.length > 300) return "";
        const p = new URL(s);
        if (p.protocol !== "wss:") return "";
        if (/onrender\.com$/i.test(p.hostname)) return "";
        if (!ALLOWED_HOST_RE.test(p.hostname)) return "";
        return s; // stringa originale: la chiave di cifratura dipende dal testo esatto dell'URL
    } catch (e) { return ""; }
}

async function verifyLicense(h) {
    const body = new URLSearchParams({
        key: String(h.key || "").trim().toUpperCase(),
        user: String(h.user || "").trim(),
        device: String(h.device || ""),
        sid: String(h.sid || ""),
        fp: String(h.fp || ""),
        takeover: "0"
    });
    const headers = { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" };
    if (ENGINE_SECRET) headers["X-Engine-Secret"] = ENGINE_SECRET;
    const r = await fetch(LICENSE_API, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
    return r.json();
}

class Session {
    constructor(ws) {
        this.ws = ws;
        this.auth = ALLOW_ANON;
        this.maxBots = MAX_BOTS_PER_SESSION;
        this.hello = null;
        this.chain = Promise.resolve();
        this.bots = [];
        this.connector = new Connector();
        this.superviseTimer = null;
        this.cfg = {
            startedBots: false, botCount: 40, agarServer: "",
            names: [DEFAULT_NAME, DEFAULT_NAME, DEFAULT_NAME, DEFAULT_NAME],
            botAi: false, vShield: false, freezeBots: false, patrolMode: false, botOPK: false,
            tricksplitActive: false, clonePlayerName: false, targetPlayerName: "",
            spawnPointActive: false, spawnPointX: 0, spawnPointY: 0,
            cords: { x: 0, y: 0 }
        };
        this.stateTimer = setInterval(() => this.pushState(), 1000);
        this.recheckTimer = ALLOW_ANON ? null : setInterval(() => this.recheck(), 120000);
        this.authTimeout = ALLOW_ANON ? null : setTimeout(() => { if (!this.auth) this.ws.close(4001, "auth timeout"); }, 10000);
        sessions.add(this);
    }

    json(obj) { if (this.ws.readyState === WS_OPEN) { try { this.ws.send(JSON.stringify(obj)); } catch (e) {} } }

    pushState() {
        let alive = 0, mass = 0;
        for (const b of this.bots) {
            if (!b.isAlive) continue;
            alive++;
            for (const id of b.myCellIDs) {
                const c = b.cells.get(id);
                if (c) mass += Math.floor((c.size * c.size) / 100);
            }
        }
        this.json({ t: "state", running: this.cfg.startedBots, count: this.bots.length, alive, mass });
    }

    async authenticate(h) {
        if (ALLOW_ANON) { this.auth = true; return; }
        try {
            const res = await verifyLicense(h);
            if (!res || !res.valid) { this.json({ t: "error", msg: "License not valid" }); this.ws.close(4003, "license"); return; }
            this.auth = true;
            this.hello = h;
            const lim = Number(res.max_bots);
            this.maxBots = lim > 0 ? Math.min(lim, MAX_BOTS_PER_SESSION) : MAX_BOTS_PER_SESSION;
            clearTimeout(this.authTimeout);
        } catch (e) {
            this.json({ t: "error", msg: "License server unreachable" });
            this.ws.close(4002, "license unreachable");
        }
    }

    async recheck() {
        if (!this.hello) return;
        try {
            const res = await verifyLicense(this.hello);
            if (res && res.valid === false) this.ws.close(4003, "license");
        } catch (e) { /* server licenze non raggiungibile: si tollera */ }
    }

    async handle(m) {
        if (!m || typeof m.t !== "string") return;
        if (m.t === "hello") return this.authenticate(m);
        if (m.t === "ping") { this.json({ t: "pong" }); return; }
        if (!this.auth) return;
        switch (m.t) {
            case "cfg": if (m.cfg && typeof m.cfg === "object") this.applyCfg(m.cfg); break;
            case "mouse": {
                const x = Number(m.x), y = Number(m.y);
                if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e6 && Math.abs(y) < 1e6) { this.cfg.cords.x = x; this.cfg.cords.y = y; }
                break;
            }
            case "split": for (const b of this.bots) b.split(); break;
            case "eject": for (const b of this.bots) b.eject(); break;
            case "reconnect": for (const b of this.bots) b.requestConnect(); break;
        }
    }

    applyCfg(c) {
        const cfg = this.cfg;
        for (const k of ["botAi", "vShield", "freezeBots", "patrolMode", "botOPK", "tricksplitActive", "clonePlayerName", "spawnPointActive"]) {
            if (typeof c[k] === "boolean") cfg[k] = c[k];
        }
        for (const k of ["spawnPointX", "spawnPointY"]) {
            const v = Number(c[k]);
            if (Number.isFinite(v) && Math.abs(v) < 1e6) cfg[k] = v;
        }
        if (Array.isArray(c.names)) {
            const arr = c.names.slice(0, 4).map(cleanName);
            while (arr.length < 4) arr.push(DEFAULT_NAME);
            cfg.names = arr;
        }
        if (typeof c.targetPlayerName === "string") cfg.targetPlayerName = c.targetPlayerName.slice(0, 15);
        const n = parseInt(c.botCount, 10);
        if (Number.isFinite(n)) cfg.botCount = Math.min(this.maxBots, Math.max(1, n));

        let serverChanged = false;
        if (typeof c.agarServer === "string" && c.agarServer) {
            const ok = validServer(c.agarServer);
            if (ok && ok !== cfg.agarServer) { cfg.agarServer = ok; serverChanged = true; }
        }

        const wasRunning = cfg.startedBots;
        if (typeof c.running === "boolean") cfg.startedBots = c.running;

        if (!cfg.startedBots) { this.stopAll(); return; }
        if (serverChanged && wasRunning) this.stopAll();
        this.ensureBots();
        const follow = !cfg.botAi && !cfg.vShield && !cfg.freezeBots && !cfg.patrolMode && !cfg.botOPK;
        for (const b of this.bots) b.followMouse = follow;
    }

    ensureBots() {
        const cfg = this.cfg;
        if (!cfg.agarServer) { this.json({ t: "error", msg: "Missing game server URL" }); return; }
        while (this.bots.length < cfg.botCount) {
            if (totalBots() >= MAX_BOTS_TOTAL) break;
            const idx = this.bots.length;
            this.bots.push(new Bot(this, nameFor(cfg, idx), idx));
        }
        while (this.bots.length > cfg.botCount) this.bots.pop().stop();
        if (!this.superviseTimer) {
            this.superviseTimer = setInterval(() => {
                const now = Date.now();
                for (const b of this.bots) { try { b.check(now); } catch (e) {} }
            }, 500);
        }
    }

    stopAll() {
        while (this.bots.length) this.bots.pop().stop();
        clearInterval(this.superviseTimer);
        this.superviseTimer = null;
    }

    destroy() {
        this.cfg.startedBots = false;
        this.stopAll();
        this.connector.destroy();
        clearInterval(this.stateTimer);
        clearInterval(this.recheckTimer);
        clearTimeout(this.authTimeout);
        sessions.delete(this);
    }
}

/* ---------------- HTTP + WebSocket ---------------- */
const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/" || url === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); return; }
    if (url === "/api/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: sessions.size, bots: totalBots() }));
        return;
    }
    res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on("connection", (ws) => {
    const session = new Session(ws);
    ws.on("message", (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch (e) { return; }
        session.chain = session.chain.then(() => session.handle(m)).catch(() => {});
    });
    ws.on("close", () => session.destroy());
    ws.on("error", () => { try { ws.terminate(); } catch (e) {} });
});

process.on("uncaughtException", (e) => console.error("uncaught:", e));
process.on("unhandledRejection", (e) => console.error("unhandled:", e));
server.listen(PORT, "0.0.0.0", () => console.log("Zero engine in ascolto sulla porta " + PORT));

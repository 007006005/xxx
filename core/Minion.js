// core/Minion.js — Zero The Legend Backend PRO (Target Nickname Follow + Farming Engine)
import { WebSocket } from "ws";
import { SmartBuffer } from "smart-buffer";
import { buffers, logger } from "../utils/index.js";

export class Minion {
  client;
  ws;
  isAlive;
  isClosed;
  name;
  x;
  y;
  size;
  playerCells;
  viruses;
  pellets;
  feedTimer;
  splitTimer;
  userX;
  userY;
  offsetX;
  offsetY;
  rX;
  rY;
  facebookBots;

  constructor(client) {
    this.client = client;
    this.ws = null;
    this.isAlive = false;
    this.isClosed = false;
    this.name = client.botName;
    this.x = 0;
    this.y = 0;
    this.size = 0;
    this.playerCells = {};
    this.viruses = {};
    this.pellets = {};
    this.feedTimer = 0;
    this.splitTimer = 0;
    this.userX = 0;
    this.userY = 0;
    this.offsetX = (Math.random() - 0.5) * 100;
    this.offsetY = (Math.random() - 0.5) * 100;
    this.rX = 1;
    this.rY = 1;
    this.facebookBots = false;

    this.connect();
  }

  connect() {
    if (this.isClosed) return;
    try {
      this.ws = new WebSocket(this.client.server, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Origin": "https://agar.io"
        },
        perMessageDeflate: false
      });
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => this.onOpen();
      this.ws.onmessage = (event) => this.onMessage(event);
      this.ws.onerror = () => this.onClose();
      this.ws.onclose = () => this.onClose();
    } catch (e) {
      this.onClose();
    }
  }

  onOpen() {
    if (this.isClosed) return;
    const writer = new SmartBuffer();
    writer.writeUInt8(254);
    writer.writeUInt32LE(6);
    this.send(writer.toBuffer(), true);

    const writer2 = new SmartBuffer();
    writer2.writeUInt8(255);
    writer2.writeUInt32LE(1);
    this.send(writer2.toBuffer(), true);

    setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const keyBuf = new SmartBuffer();
        keyBuf.writeUInt8(80);
        for (let i = 0; i < 4; i++) keyBuf.writeUInt8(0);
        this.send(keyBuf.toBuffer(), true);

        const spawnBuf = new SmartBuffer();
        spawnBuf.writeUInt8(0);
        spawnBuf.writeStringNT(this.name);
        this.send(spawnBuf.toBuffer(), true);
      }
    }, 300);

    this.facebookBots = true;
  }

  send(buffer, bypass = false) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(buffer);
      } catch (e) {}
    }
  }

  onMessage(event) {
    if (!(event.data instanceof ArrayBuffer)) return;
    const reader = SmartBuffer.fromBuffer(event.data);
    if (reader.remaining() < 1) return;
    const opcode = reader.readUInt8();

    switch (opcode) {
      case 16: // World Update
        this.parseWorldUpdate(reader);
        break;
      case 64: // Stats / Viewport
        if (reader.remaining() >= 32) {
          const minX = reader.readDoubleLE();
          const minY = reader.readDoubleLE();
          const maxX = reader.readDoubleLE();
          const maxY = reader.readDoubleLE();
          this.rX = (maxX - minX) / 14142;
          this.rY = (maxY - minY) / 14142;
        }
        break;
    }
  }

  parseWorldUpdate(reader) {
    // Rimuove nodi distrutti
    const removeLen = reader.readUInt16LE();
    for (let i = 0; i < removeLen; i++) {
      const id = reader.readUInt32LE();
      delete this.playerCells[id];
      delete this.pellets[id];
      delete this.viruses[id];
    }

    // Aggiorna/Aggiunge nodi
    while (true) {
      const id = reader.readUInt32LE();
      if (id === 0) break;

      const x = reader.readInt32LE();
      const y = reader.readInt32LE();
      const size = reader.readUInt16LE();
      const colorR = reader.readUInt8();
      const colorG = reader.readUInt8();
      const colorB = reader.readUInt8();
      const flags = reader.readUInt8();

      const isVirus = (flags & 1) !== 0;
      const isPellet = !isVirus && size < 20;

      let name = "";
      while (reader.remaining() > 0) {
        const charCode = reader.readUInt16LE();
        if (charCode === 0) break;
        name += String.fromCharCode(charCode);
      }

      const cell = { id, x, y, size, name, color: [colorR, colorG, colorB] };

      if (isPellet) {
        this.pellets[id] = cell;
      } else if (isVirus) {
        this.viruses[id] = cell;
      } else {
        this.playerCells[id] = cell;
      }
    }

    this.updatePosition();
  }

  updatePosition() {
    let sumX = 0, sumY = 0, totalSize = 0, count = 0;
    for (const cell of Object.values(this.playerCells)) {
      sumX += cell.x;
      sumY += cell.y;
      totalSize += cell.size;
      count++;
    }

    if (count > 0) {
      this.isAlive = true;
      this.x = sumX / count;
      this.y = sumY / count;
      this.size = totalSize / count;

      const target = this.nearestPlayer(this.x, this.y, this.size);
      const moveBuf = new SmartBuffer();
      moveBuf.writeUInt8(16);
      moveBuf.writeInt32LE(Math.round(target.x));
      moveBuf.writeInt32LE(Math.round(target.y));
      moveBuf.writeUInt32LE(0);
      this.send(moveBuf.toBuffer());
    } else {
      this.isAlive = false;
      // Respawn automatico se morto
      if (Math.random() < 0.1) {
        const spawnBuf = new SmartBuffer();
        spawnBuf.writeUInt8(0);
        spawnBuf.writeStringNT(this.name);
        this.send(spawnBuf.toBuffer(), true);
      }
    }
  }

  nearestPlayer(x, y, size) {
    const maxDistance = 2000;
    
    // Gestione Follow per Nickname o coordinate del mouse
    let targetX = this.client.userX / this.rX;
    let targetY = this.client.userY / this.rY;
    const followByName = this.client.targetNickname; // Target impostato dal client

    if (followByName && followByName.trim() !== "") {
      const searchName = followByName.trim().toLowerCase();
      for (const cell of Object.values(this.playerCells)) {
        if (cell.name && cell.name.toLowerCase().includes(searchName)) {
          targetX = cell.x;
          targetY = cell.y;
          break;
        }
      }
    }

    // Se siamo in modalità Farming e non seguiamo un player specifico, cerca il pellet più vicino
    if (!followByName && !this.client.botAi) {
      let closestPellet = null;
      let minDst = Infinity;
      for (const p of Object.values(this.pellets)) {
        const dst = Math.hypot(p.x - x, p.y - y);
        if (dst < minDst && dst < 800) {
          minDst = dst;
          closestPellet = p;
        }
      }
      if (closestPellet) {
        targetX = closestPellet.x;
        targetY = closestPellet.y;
      }
    }

    const dx = targetX - x;
    const dy = targetY - y;
    const dist = 1 + Math.hypot(dx, dy);

    return {
      x: x + (dx / dist) * maxDistance,
      y: y + (dy / dist) * maxDistance
    };
  }

  split() {
    const buf = new Uint8Array([17]);
    this.send(buf, true);
  }

  eject() {
    const buf = new Uint8Array([21]);
    this.send(buf, true);
  }

  stop() {
    this.isClosed = true;
    try {
      this.ws?.close();
    } catch (e) {}
  }

  onClose() {
    this.isAlive = false;
    this.isClosed = true;
  }
}

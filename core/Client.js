// core/Client.js — Zero The Legend Backend PRO (Optimized & Aligned)
import { WebSocket } from "ws";
import { SmartBuffer } from "smart-buffer";
import { logger } from "../utils/index.js";

export default class Client {
  server;
  ws;
  isAlive;
  isClosed;
  botName;
  x;
  y;
  size;
  playerCells;
  viruses;
  pellets;
  userX;
  userY;
  offsetX;
  offsetY;
  rX;
  rY;
  facebookBots;
  targetNickname;
  botAi;
  minions = []; // Gestione interna dei minion/bot multipli

  constructor(ws, globalStats, serverUrl = "wss://xxx-6j2x.onrender.com") {
    this.ws = ws;
    this.globalStats = globalStats;
    this.server = serverUrl;
    this.isAlive = false;
    this.isClosed = false;
    this.botName = "ZeroTheLegend";
    this.targetNickname = "xxx";
    this.botAi = false;
    this.userX = 0;
    this.userY = 0;
    this.lastActivity = Date.now();
  }

  // ═══ METODO RICHIESTO DAL SERVER ═══
  handleMessage(buffer) {
    this.lastActivity = Date.now();
    try {
      if (!buffer || buffer.byteLength < 1) return;
      
      const reader = SmartBuffer.fromBuffer(buffer);
      const opcode = reader.readUInt8();

      // Gestione comandi in arrivo dal Tampermonkey script
      switch (opcode) {
        case 16: // Aggiornamento coordinate mouse dal client principale
          if (reader.remaining() >= 8) {
            this.userX = reader.readInt32LE();
            this.userY = reader.readInt32LE();
          }
          break;
        case 0:
          break;
        default:
          break;
      }
    } catch (e) {
      throw new Error(`Invalid packet structure: ${e.message}`);
    }
  }

  // Metodo per avviare i bot collegati a questo client WebSocket
  startBots(count = 10, targetServer) {
    if (targetServer) this.server = targetServer;
    for (let i = 0; i < count; i++) {
      this.minions.push(new MinionInstance(this, i));
    }
  }

  stopBots() {
    this.isClosed = true;
    this.minions.forEach(m => {
      try { m.stop(); } catch (e) {}
    });
    this.minions = [];
  }
}

// Classe interna che gestisce la singola connessione WebSocket del singolo bot verso Agar.io
class MinionInstance {
  constructor(client, index) {
    this.client = client;
    this.ws = null;
    this.isAlive = false;
    this.isClosed = false;
    this.name = `${client.botName} ${index + 1}`;
    this.x = 0;
    this.y = 0;
    this.size = 0;
    this.playerCells = {};
    this.viruses = {};
    this.pellets = {};
    this.rX = 1;
    this.rY = 1;
    this.targetNickname = client.targetNickname;

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
    }, 50);
  }

  send(buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(buffer); } catch (e) {}
    }
  }

  onMessage(event) {
    if (!(event.data instanceof ArrayBuffer)) return;
    const reader = SmartBuffer.fromBuffer(event.data);
    if (reader.remaining() < 1) return;
    const opcode = reader.readUInt8();

    switch (opcode) {
      case 16:
        this.parseWorldUpdate(reader);
        break;
      case 64:
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
    const removeLen = reader.readUInt16LE();
    for (let i = 0; i < removeLen; i++) {
      const id = reader.readUInt32LE();
      delete this.playerCells[id];
      delete this.pellets[id];
      delete this.viruses[id];
    }

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
      while (reader.remaining() > 1) {
        const charCode = reader.readUInt16LE();
        if (charCode === 0) break;
        name += String.fromCharCode(charCode);
      }

      const cell = { id, x, y, size, name };

      if (isPellet) this.pellets[id] = cell;
      else if (isVirus) this.viruses[id] = cell;
      else this.playerCells[id] = cell;
    }

    this.updatePosition();
  }

  // Trova il pellet (cibo) più vicino alla cella del bot per il Farming
  nearestPellet(x, y) {
    let nearest = null;
    let minDist = Infinity;
    for (const pellet of Object.values(this.pellets)) {
      const dx = pellet.x - x;
      const dy = pellet.y - y;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        nearest = pellet;
      }
    }
    return nearest;
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

      let targetX, targetY;

      // 🤖 SE L'AI (FARMING) È ATTIVA: Cerca e punta il cibo (pellet) più vicino
      if (this.client.botAi) {
        const nearestP = this.nearestPellet(this.x, this.y);
        if (nearestP) {
          targetX = nearestP.x;
          targetY = nearestP.y;
        } else {
          // Fallback: se non vede cibo vicino, segue il mouse del giocatore
          targetX = this.client.userX || this.x;
          targetY = this.client.userY || this.y;
        }
      } else {
        // 🎮 MODALITÀ FOLLOW: Segue le coordinate del mouse del giocatore
        const maxDistance = 2000;
        let mouseX = this.client.userX || this.x;
        let mouseY = this.client.userY || this.y;
        
        const dx = mouseX - this.x;
        const dy = mouseY - this.y;
        const dist = 1 + Math.hypot(dx, dy);

        targetX = this.x + (dx / dist) * maxDistance;
        targetY = this.y + (dy / dist) * maxDistance;
      }

      // Invia il pacchetto di movimento (Opcode 16) al server di gioco
      const moveBuf = new SmartBuffer();
      moveBuf.writeUInt8(16);
      moveBuf.writeInt32LE(Math.round(targetX));
      moveBuf.writeInt32LE(Math.round(targetY));
      moveBuf.writeUInt32LE(0);
      this.send(moveBuf.toBuffer());
    } else {
      this.isAlive = false;
      // Tenta il respawn automatico se il bot è morto
      if (Math.random() < 0.2) {
        const spawnBuf = new SmartBuffer();
        spawnBuf.writeUInt8(0);
        spawnBuf.writeStringNT(this.name);
        this.send(spawnBuf.toBuffer());
      }
    }
  }

  stop() {
    this.isClosed = true;
    try { this.ws?.close(); } catch (e) {}
  }

  onClose() {
    this.isAlive = false;
    this.isClosed = true;
  }
}

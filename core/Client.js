import { WebSocket } from "ws";
import { Minion } from "./Minion.js";
import { buffers, logger } from "../utils/index.js";
import { config } from "../config/index.js";
import { SmartBuffer } from "smart-buffer";

export default class Client {
  ws;
  bots;
  userX;
  userY;
  botAi;
  botName;
  botAmount;
  isAlive;
  rQuadrant;
  playerName;
  botVShield;
  startedBots;
  stoppedBots;
  connectedBots;
  server;
  botTimeout;
  botInt;
  countInt;
  port1;
  port2;
  port3;
  port4;

  constructor(ws) {
    this.ws = ws;
    this.bots = [];
    this.userX = 0;
    this.userY = 0;
    this.botAi = false; // false = farming, true = follow (o viceversa a seconda della logica)
    this.server = null;
    this.botName = "ȤÊɌØ IS GOD";
    this.botAmount = config.facebookBotSettings.botAmount;
    this.rQuadrant = 0;
    this.botInt = null;
    this.playerName = "ȤÊɌØ IS GOD";
    this.countInt = null;
    this.botTimeout = [];
    this.isAlive = false;
    this.connectedBots = 0;
    this.botVShield = false;
    this.stoppedBots = true;
    this.startedBots = false;
    this.port1 = "";
    this.port2 = "";
    this.port3 = "";
    this.port4 = "";
  }

  async handleMessage(buffer) {
    const reader = SmartBuffer.fromBuffer(buffer);
    const opcode = reader.readUInt8();

    switch (opcode) {
      case 0: // START BOTS (Legge Server, Nome, le 4 Porte e la Quantità)
        this.server = reader.readStringNT();
        this.botName = reader.readStringNT();
        this.port1 = reader.readStringNT();
        this.port2 = reader.readStringNT();
        this.port3 = reader.readStringNT();
        this.port4 = reader.readStringNT();
        this.botAmount = reader.readUInt16LE();
        
        this.botAmount = Math.max(
          1,
          Math.min(this.botAmount, config.facebookBotSettings.maxBots || 2000)
        );
        this.startBots();
        break;

      case 1: // STOP BOTS
        this.stopBots();
        break;

      case 2: // SET MODE (Farming / Follow - Inviato dal tasto I o dal menu)
        {
          const subType = reader.readUInt8();
          if (subType === 1) {
            const modeVal = reader.readUInt8();
            // 1 = farming, 2 = follow
            this.botAi = (modeVal === 2);
          }
        }
        break;

      case 3: // FEED (Tasto C)
        for (const bot of this.bots) {
          if (bot.ws?.readyState === 1 && bot.isAlive) {
            bot.send(buffers.eject(), true);
          }
        }
        break;

      case 4: // SPLIT (Tasto Z)
        for (const bot of this.bots) {
          if (bot.ws?.readyState === 1 && bot.isAlive) {
            bot.send(buffers.split(), true);
          }
        }
        break;

      case 6: // SHIELD / ANTI-VIRUS (Tasto V)
        // Legge 1 byte booleano (0 o 1)
        this.botVShield = !!reader.readUInt8();
        logger.info(`Client Shield Anti-Virus: ${this.botVShield ? "ON" : "OFF"}`);
        break;

      case 23: // MOUSE POSITION / FOLLOW (Inviato ogni 35ms in modalità Follow)
      case 5:
        this.userX = reader.readInt32LE();
        this.userY = reader.readInt32LE();
        for (const bot of this.bots) {
          if (bot.ws?.readyState === 1 && bot.isAlive) {
            bot.setTarget(this.userX, this.userY);
          }
        }
        break;

      case 7: // AUTO-RECONNECT O CONFIG EXTRA
        this.rQuadrant = reader.readUInt8();
        break;
    }
  }

  startBots() {
    if (!this.startedBots) {
      this.stoppedBots = false;
      this.startedBots = true;
      const maxBots = this.botAmount;

      this.botInt = setInterval(() => {
        if (this.bots.length < maxBots) {
          this.bots.push(new Minion(this));
        }
      }, 300);

      this.countInt = setInterval(() => {
        this.bots = this.bots.filter((bot) => !bot.isClosed);
        const aliveBots = this.bots.filter(
          (bot) => bot.ws?.readyState === WebSocket.OPEN && bot.isAlive
        ).length;
        const facebookBots = this.bots.filter(
          (bot) =>
            bot.ws?.readyState === WebSocket.OPEN &&
            bot.isAlive &&
            bot.facebookBots
        ).length;
        this.ws?.send(
          buffers.sendBotCount(`${aliveBots}/${facebookBots}/${maxBots}`)
        );
      }, 300);

      logger.info(`Client Starting Bots (${maxBots}) for server: ${this.server}`);
    }
  }

  stopBots() {
    if (this.startedBots || !this.stoppedBots) {
      clearInterval(this.botInt);
      clearInterval(this.countInt);
      this.botTimeout.forEach((id) => clearTimeout(id));
      this.bots.forEach((bot) => bot.stop());
      this.botInt = null;
      this.countInt = null;
      this.bots.length = 0;
      this.stoppedBots = true;
      this.startedBots = false;
      this.botTimeout.length = 0;
      this.ws?.send(Buffer.from([1]));
      logger.warn(`Client Bots Stopped!`);
    }
  }
}

// core/Client.js — Zero The Legend Backend PRO (Fixed Mode & Follow Propagation)
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
  targetNickname;

  constructor(ws) {
    this.ws = ws;
    this.bots = [];
    this.userX = 0;
    this.userY = 0;
    this.botAi = false; // false = farming, true = follow
    this.server = null;
    this.botName = "ȤÊɌØ IS GOD";
    this.botAmount = config.facebookBotSettings?.botAmount || 150;
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
    this.targetNickname = "xxx";
  }

  async handleMessage(buffer) {
    const reader = SmartBuffer.fromBuffer(buffer);
    if (reader.remaining() < 1) return;
    const opcode = reader.readUInt8();

    switch (opcode) {
      case 0: {
        this.server = reader.readStringNT();
        this.botName = reader.readStringNT();
        this.port1 = reader.readStringNT();
        this.port2 = reader.readStringNT();
        this.port3 = reader.readStringNT();
        this.port4 = reader.readStringNT();
        this.botAmount = reader.readUInt16LE();
        
        this.botAmount = Math.max(
          1,
          Math.min(this.botAmount, config.facebookBotSettings?.maxBots || 2000)
        );
        this.startBots();
        break;
      }

      case 1: {
        this.stopBots();
        break;
      }

      case 2: { // Cambio Modalità (Farming / Follow)
        const subType = reader.readUInt8();
        if (subType === 1) {
          const modeVal = reader.readUInt8();
          this.botAi = (modeVal === 2); // 2 = Follow mode, 1 = Farming
          
          // Aggiorna istantaneamente tutti i minion attivi
          for (const bot of this.bots) {
            bot.botAi = this.botAi;
          }
          logger.info(`[SERVER] Modalità cambiata -> Follow Mode: ${this.botAi}`);
        }
        break;
      }

      case 3: { // FEED
        for (const bot of this.bots) {
          if (bot.ws?.readyState === 1 && bot.isAlive) {
            if (typeof bot.eject === "function") bot.eject();
            else bot.send(buffers.eject(), true);
          }
        }
        break;
      }

      case 4: { // SPLIT
        for (const bot of this.bots) {
          if (bot.ws?.readyState === 1 && bot.isAlive) {
            if (typeof bot.split === "function") bot.split();
            else bot.send(buffers.split(), true);
          }
        }
        break;
      }

      case 5:
      case 23: {
        this.userX = reader.readInt32LE();
        this.userY = reader.readInt32LE();
        for (const bot of this.bots) {
          bot.userX = this.userX;
          bot.userY = this.userY;
        }
        break;
      }

      case 8: { // Sincronizzazione Nickname Target
        try {
          this.targetNickname = reader.readStringNT();
          for (const bot of this.bots) {
            bot.targetNickname = this.targetNickname;
          }
          logger.info(`[SERVER] Target Nickname impostato: "${this.targetNickname}"`);
        } catch (e) {}
        break;
      }
    }
  }

  startBots() {
    if (!this.startedBots) {
      this.stoppedBots = false;
      this.startedBots = true;
      const maxBots = this.botAmount;

      this.botInt = setInterval(() => {
        if (this.bots.length < maxBots && !this.stoppedBots) {
          const minion = new Minion(this);
          minion.botAi = this.botAi;
          minion.targetNickname = this.targetNickname;
          this.bots.push(minion);
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
      try {
        this.ws?.send(Buffer.from([1]));
      } catch (e) {}
    }
  }
}

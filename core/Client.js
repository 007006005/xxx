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
  constructor(ws) {
    this.ws = ws;
    this.bots = [];
    this.userX = 0;
    this.userY = 0;
    this.botAi = false;
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
  }
  async handleMessage(buffer) {
    const reader = SmartBuffer.fromBuffer(buffer);
    const opcode = reader.readUInt8();
    switch (opcode) {
      case 0:
        this.server = reader.readStringNT();
        this.botName = reader.readStringNT();
        this.botAmount = reader.readUInt16LE();
        // Tetto massimo: se il client chiede più di maxBots, usa maxBots.
        this.botAmount = Math.max(
          1,
          Math.min(this.botAmount, config.facebookBotSettings.maxBots)
        );
        this.startBots();
        break;
      case 1:
        this.stopBots();
        break;
      case 2:
        reader.readUInt8() == 1
          ? (this.botAi = !!reader.readUInt8())
          : (this.botVShield = !!reader.readUInt8());
        break;
      case 3:
        for (const bot of this.bots)
          if (
            bot.ws?.readyState === 1 &&
            bot.isAlive &&
            !this.botAi &&
            bot.isNearMouse &&
            bot.followMouse
          )
            bot.send(buffers.eject(), true);
        break;
      case 4:
        for (const bot of this.bots)
          if (
            bot.ws?.readyState === 1 &&
            bot.isAlive &&
            !this.botAi &&
            bot.isNearMouse &&
            bot.followMouse
          )
            bot.send(buffers.split(), true);
        break;
      case 5:
        this.userX = reader.readInt32LE();
        this.userY = reader.readInt32LE();
        break;
      case 6:
        this.isAlive = !!reader.readUInt8();
        this.playerName = reader.readStringNT();
        break;
      case 7:
        this.rQuadrant = reader.readUInt8();
        break;
    }
  }
  startBots() {
    if (!this.startedBots) {
      this.stoppedBots = false;
      const maxBots = this.botAmount;
      this.botInt = setInterval(() => {
        if (this.connectedBots < maxBots && this.bots.length < maxBots) {
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
      logger.info(`Client Starting Bots.`);
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

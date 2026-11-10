// Client.js — pannello di controllo; non crea né possiede bot.
// Le sessioni bot sono gestite esclusivamente da BotEngine.js.
export default class Client {
  constructor(ws, engine, ownerId) {
    this.ws = ws;
    this.engine = engine;
    this.ownerId = ownerId;
    this.closed = false;
    this.lastActivity = Date.now();
  }

  handleMessage(buffer) {
    if (this.closed || !buffer) return false;
    const packet = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (packet.length < 9 || packet.readUInt8(0) !== 16) return false;

    const x = packet.readInt32LE(1);
    const y = packet.readInt32LE(5);
    this.lastActivity = Date.now();
    return this.engine.updateTarget(this.ownerId, x, y);
  }

  disconnect() {
    if (this.closed) return;
    this.closed = true;
    // Disconnettere il pannello non arresta la sessione bot.
    this.engine.setPanelConnected(this.ownerId, false);
  }
}

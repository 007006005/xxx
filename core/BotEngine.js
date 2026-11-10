import Minion from "./Minion.js";

const DEFAULT_MAX_BOTS = 40;

function allowedHosts() {
  return new Set(
    String(process.env.GAME_SERVER_ALLOWLIST || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function validateGameServer(serverUrl) {
  let parsed;
  try {
    parsed = new URL(String(serverUrl || ""));
  } catch {
    throw new Error("Indirizzo server non valido");
  }

  if (parsed.protocol !== "wss:") {
    throw new Error("Il server di gioco deve usare WSS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credenziali non ammesse nell'indirizzo server");
  }

  const hosts = allowedHosts();
  if (!hosts.size || !hosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("Server non autorizzato: configura GAME_SERVER_ALLOWLIST su Render");
  }

  return parsed.toString();
}

function clampCount(value, licenseMaxBots) {
  const count = Number(value);
  const ceiling = Math.max(1, Math.min(
    Number(process.env.MAX_BOTS_PER_SESSION) || DEFAULT_MAX_BOTS,
    Number(licenseMaxBots) || 1
  ));

  if (!Number.isInteger(count) || count < 1 || count > ceiling) {
    throw new Error(`Numero bot non valido (limite licenza: ${ceiling})`);
  }
  return count;
}

export default class BotEngine {
  constructor() {
    this.sessions = new Map();
  }

  start(ownerId, options = {}) {
    const server = validateGameServer(options.agarServer);
    const botCount = clampCount(options.botCount ?? 1, options.licenseMaxBots);
    this.stop(ownerId);

    const names = Array.isArray(options.botNames)
      ? options.botNames.map((name) => String(name).trim()).filter(Boolean)
      : [];
    if (!names.length) names.push("ZeroTheLegend");

    const config = {
      cords: { x: 0, y: 0 },
      botCount,
      botCount,
      spawnPointActive: Boolean(options.spawnPointActive),
      spawnPointX: Number(options.spawnPointX) || 0,
      spawnPointY: Number(options.spawnPointY) || 0,
      botAi: Boolean(options.botAi),
      botOPK: Boolean(options.botOPK),
      vShield: Boolean(options.vShield),
      freezeBots: Boolean(options.freezeBots),
      patrolMode: Boolean(options.patrolMode),
      tricksplitActive: Boolean(options.tricksplitActive),
      clonePlayerName: false,
      targetPlayerName: "",
      names,
    };

    const controller = {
      server,
      userX: 0,
      userY: 0,
      botAi: config.botAi,
      targetNickname: String(options.targetNickname || ""),
      config,
    };

    const session = {
      ownerId,
      server,
      controller,
      bots: [],
      botCount,
      startedAt: Date.now(),
      panelConnected: false,
      licenseMaxBots: Number(options.licenseMaxBots) || 1,
    };

    try {
      for (let index = 0; index < botCount; index++) {
        const botName = names[index % names.length] || "ZeroTheLegend";
        const botClient = {
          ...controller,
          botName: `${botName} ${index + 1}`,
          index,
        };
        session.bots.push(new Minion(botClient));
      }
    } catch (error) {
      for (const bot of session.bots) bot.stop();
      throw error;
    }

    this.sessions.set(ownerId, session);
    return this.status(ownerId);
  }

  update(ownerId, patch = {}) {
    const session = this.sessions.get(ownerId);
    if (!session) throw new Error("Nessuna sessione bot attiva");

    if (patch.botCount !== undefined && Number(patch.botCount) !== session.botCount) {
      const nextCount = clampCount(patch.botCount, session.licenseMaxBots);
      if (nextCount < session.bots.length) {
        for (const bot of session.bots.splice(nextCount)) bot.stop();
      } else {
        const names = session.controller.config.names;
        for (let index = session.bots.length; index < nextCount; index++) {
          const name = names[index % names.length] || "ZeroTheLegend";
          session.bots.push(new Minion({
            ...session.controller,
            botName: `${name} ${index + 1}`,
            index,
          }));
        }
      }
      session.botCount = nextCount;
      session.controller.config.botCount = nextCount;
    }

    if (Array.isArray(patch.botNames)) {
      const names = patch.botNames.map((name) => String(name).trim()).filter(Boolean);
      if (names.length) session.controller.config.names = names;
    }

    const booleanFields = [
      "botAi", "botOPK", "vShield", "freezeBots",
      "patrolMode", "tricksplitActive", "spawnPointActive",
    ];
    for (const field of booleanFields) {
      if (typeof patch[field] === "boolean") {
        session.controller.config[field] = patch[field];
      }
    }

    if (patch.spawnPointX !== undefined) {
      session.controller.config.spawnPointX = Number(patch.spawnPointX) || 0;
    }
    if (patch.spawnPointY !== undefined) {
      session.controller.config.spawnPointY = Number(patch.spawnPointY) || 0;
    }
    if (patch.targetNickname !== undefined) {
      session.controller.targetNickname = String(patch.targetNickname).slice(0, 64);
    }

    session.controller.botAi = session.controller.config.botAi;
    for (const bot of session.bots) {
      bot.botAi = session.controller.config.botAi;
      bot.followMouse = !session.controller.config.botAi
        && !session.controller.config.vShield
        && !session.controller.config.freezeBots
        && !session.controller.config.patrolMode
        && !session.controller.config.botOPK;
    }

    return this.status(ownerId);
  }

  command(ownerId, action) {
    const session = this.sessions.get(ownerId);
    if (!session) throw new Error("Nessuna sessione bot attiva");
    if (action === "split") {
      for (const bot of session.bots) bot.split();
    } else if (action === "eject") {
      for (const bot of session.bots) bot.eject();
    } else if (action === "reconnect") {
      for (const bot of session.bots) bot.reconnect();
    } else {
      throw new Error("Comando bot non supportato");
    }
    return this.status(ownerId);
  }

  command(ownerId, action) {
    const session = this.sessions.get(ownerId);
    if (!session) throw new Error("Nessuna sessione bot attiva");
    if (action === "split") {
      for (const bot of session.bots) bot.split();
    } else if (action === "eject") {
      for (const bot of session.bots) bot.eject();
    } else if (action === "reconnect") {
      for (const bot of session.bots) bot.reconnect();
    } else {
      throw new Error("Comando bot non supportato");
    }
    return this.status(ownerId);
  }

  updateTarget(ownerId, x, y) {
    const session = this.sessions.get(ownerId);
    if (!session) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    session.controller.userX = Math.round(x);
    session.controller.userY = Math.round(y);
    session.controller.config.cords.x = session.controller.userX;
    session.controller.config.cords.y = session.controller.userY;
    return true;
  }

  setPanelConnected(ownerId, connected) {
    const session = this.sessions.get(ownerId);
    if (session) session.panelConnected = Boolean(connected);
  }

  stop(ownerId) {
    const session = this.sessions.get(ownerId);
    if (!session) return false;
    for (const bot of session.bots) {
      try { bot.stop(); } catch {}
    }
    this.sessions.delete(ownerId);
    return true;
  }

  stopAll() {
    for (const ownerId of this.sessions.keys()) this.stop(ownerId);
  }

  status(ownerId) {
    const session = this.sessions.get(ownerId);
    if (!session) {
      return { isRunning: false, botCount: 0, panelConnected: false };
    }
    return {
      isRunning: true,
      botCount: session.bots.length,
      agarServer: session.server,
      panelConnected: session.panelConnected,
      uptimeSeconds: Math.floor((Date.now() - session.startedAt) / 1000),
      spawnPointActive: session.controller.config.spawnPointActive,
      spawnPointX: session.controller.config.spawnPointX,
      spawnPointY: session.controller.config.spawnPointY,
    };
  }

  stats() {
    let activeBots = 0;
    for (const session of this.sessions.values()) activeBots += session.bots.length;
    return { sessions: this.sessions.size, activeBots };
  }
}

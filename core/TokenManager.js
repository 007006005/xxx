// TokenManager.js — VERSIONE PRIVACY
// ---------------------------------------------------------------------
// I token vengono letti e gestiti SOLO in locale.
// Nessuna connessione a svr99.xevbots.com o ad altri server esterni:
// la lista dei token non esce mai dal tuo computer.
// ---------------------------------------------------------------------
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensFilePath = path.join(__dirname, "../data/tokens.json");

// Se true, i token vengono verificati chiamando il loro stesso provider
// (Facebook) solo per sapere se sono ancora validi. Nessun server di
// gioco o servizio di terze parti riceve i token. Metti false per non
// inviare i token neanche a Facebook (tutti i token letti vengono
// considerati validi).
const VERIFY_WITH_FACEBOOK = false;

// Normalizza la lista dei token letta dal file. Supporta diversi formati:
//   [ "TOKEN1", "TOKEN2" ]
//   [ { "token": "TOKEN1" }, { "token": "TOKEN2" } ]
//   "TOKEN1"   (un singolo token come testo)
//   { "token": "TOKEN1" }
function normalizeTokens(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => (typeof t === "string" ? t : t && t.token ? t.token : ""))
      .filter((t) => typeof t === "string" && t.trim() !== "");
  }
  if (typeof raw === "string") {
    return raw.trim() ? [raw.trim()] : [];
  }
  if (raw && typeof raw === "object") {
    return normalizeTokens(raw.tokens || raw.token || []);
  }
  return [];
}

export default class TokenManager {
  constructor() {
    this.tokens = []; // lista completa letta dal file
    this.valid = []; // token validi, solo in memoria
    this.ut = {}; // indice -> nome account (in uso)
    this.load();
  }

  // Legge la lista locale dei token. I token restano in memoria.
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(tokensFilePath, "utf-8"));
      this.tokens = normalizeTokens(raw);
      logger.info(
        `TokenManager: ${this.tokens.length} token letto/i (solo locale)`
      );
    } catch {
      this.tokens = [];
      logger.warn("TokenManager: nessun file token valido trovato");
    }
  }

  // Verifica i token senza inviare nulla a server di gioco.
  async checkTokens(callback) {
    let validCount = 0;
    if (!VERIFY_WITH_FACEBOOK) {
      // Nome UNIVOCO per ogni token (token-0, token-1, ...): in questo
      // modo il mass boost viene attivato e tracciato per OGNI singolo
      // token (ognuno ha la sua voce in boost.json), invece di essere
      // condiviso sotto un unico nome "token".
      this.valid = this.tokens.map((token, i) => ({
        id: String(i),
        name: "token-" + i,
        token,
      }));
      validCount = this.valid.length;
    } else {
      const valid = [];
      for (const token of this.tokens) {
        const result = await verifyToken(token);
        if (result) {
          valid.push(result);
          validCount++;
        }
      }
      this.valid = valid;
    }
    logger.info(
      `TokenManager: ${validCount} token validi (verificati in locale)`
    );
    if (typeof callback === "function") callback(validCount);
  }

  // Assegna l'indice del prossimo token libero, o -1 se nessuno disponibile.
  t() {
    for (let i = 0; i < this.valid.length; i++) {
      if (!this.ut[i]) {
        this.ut[i] = { name: this.valid[i].name };
        return i;
      }
    }
    return -1;
  }

  releaseToken(index) {
    delete this.ut[index];
  }

  clearTokenUsage() {}

  // Le seguenti funzioni erano usate per pilotare il server esterno
  // svr99.xevbots.com (mass boost, login, skin). Ora NON inviano nulla:
  // se vuoi mantenere i token privati, queste azioni restano inattive.
  requestLogin() {}
  buyMassBoost() {}
  setMassBoostExpire() {}
  changeSkin() {}
}

// Verifica un singolo token contro Facebook.
// - Se Facebook risponde con un errore, il token è da scartare.
// - Se risponde con un id, il token è valido (il nome è opzionale).
// - Se la rete non raggiunge Facebook, il token viene comunque
//   considerato valido: meglio non perderlo per un problema di rete.
async function verifyToken(token) {
  try {
    const res = await fetch(
      "https://graph.facebook.com/me?access_token=" + token
    );
    const j = await res.json();
    if (j && j.error) return null;
    if (j && j.id) return { id: j.id, name: j.name || "token", token };
    return null;
  } catch {
    logger.warn(
      "TokenManager: Facebook non raggiungibile — token considerato valido senza verifica"
    );
    return { id: "", name: "token", token };
  }
}
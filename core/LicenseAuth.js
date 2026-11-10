import crypto from "node:crypto";

const ISSUER = "https://master-elettroerosioni.it";
const AUDIENCE = "zero-render-engine";
const MAX_TOKEN_LIFETIME_SECONDS = 15 * 60;

function publicKey() {
  const value = process.env.LICENSE_PUBLIC_KEY;
  if (!value || !value.includes("BEGIN PUBLIC KEY")) {
    throw new Error("LICENSE_PUBLIC_KEY non configurata: inserire la chiave pubblica RS256 del portale");
  }
  return value.replace(/\\n/g, "\n");
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function verifyLicenseToken(token) {
  if (typeof token !== "string") throw new Error("Token mancante");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Token JWT non valido");
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== "RS256" || header.typ !== "JWT") throw new Error("Algoritmo token non consentito");
  const valid = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), publicKey(), Buffer.from(parts[2], "base64url"));
  if (!valid) throw new Error("Firma token non valida");
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== ISSUER || payload.aud !== AUDIENCE) throw new Error("Emittente o destinatario token non valido");
  if (typeof payload.sub !== "string" || !/^[a-f0-9]{64}$/.test(payload.sub)) throw new Error("Identificativo licenza non valido");
  if (!Number.isInteger(payload.iat) || payload.iat > now + 60 || !Number.isInteger(payload.exp) || payload.exp <= now || payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error("Token scaduto o con durata non valida");
  }
  if (!Number.isInteger(payload.maxBots) || payload.maxBots < 1 || payload.maxBots > 200) throw new Error("Limite bot nel token non valido");
  return payload;
}

export function licenseAuth() {
  return function requireLicense(req, res, next) {
    try {
      const authorization = req.headers.authorization || "";
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) return res.status(401).json({ error: "Autenticazione richiesta" });
      const payload = verifyLicenseToken(match[1]);
      req.license = { maxBots: Math.max(1, Math.min(payload.maxBots, Number(process.env.MAX_BOTS_PER_SESSION) || 40)) };
      req.ownerId = payload.sub;
      next();
    } catch (error) {
      return res.status(401).json({ error: error.message || "Autenticazione non valida" });
    }
  };
}

import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 15 * 60;

function secret() {
  const value = process.env.LICENSE_TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new Error("LICENSE_TOKEN_SECRET deve contenere almeno 32 caratteri");
  }
  return value;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createLicenseToken(licenseKey, maxBots) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: String(licenseKey),
    maxBots: Number(maxBots) || 1,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }));
  const unsigned = `${header}.${payload}`;
  return {
    token: `${unsigned}.${sign(unsigned)}`,
    expiresIn: TOKEN_TTL_SECONDS,
  };
}

export function verifyLicenseToken(token) {
  if (typeof token !== "string") throw new Error("Token mancante");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token non valido");

  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(unsigned));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("Firma token non valida");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Payload token non valido");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || !Number.isInteger(payload.exp) || payload.exp <= now) {
    throw new Error("Token scaduto o incompleto");
  }
  return payload;
}

export function licenseAuth(validateLicenseKey) {
  return async function requireLicense(req, res, next) {
    try {
      const authorization = req.headers.authorization || "";
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) return res.status(401).json({ error: "Autenticazione richiesta" });

      const payload = verifyLicenseToken(match[1]);
      const result = await validateLicenseKey(payload.sub);
      if (!result.valid) return res.status(401).json({ error: result.reason || "Licenza non valida" });

      req.license = {
        licenseKey: payload.sub,
        maxBots: Math.max(1, Math.min(
          Number(payload.maxBots) || 1,
          Number(result.data.max_bots) || 1
        )),
      };
      req.ownerId = crypto.createHash("sha256").update(payload.sub).digest("hex");
      next();
    } catch (error) {
      return res.status(401).json({ error: error.message || "Autenticazione non valida" });
    }
  };
}

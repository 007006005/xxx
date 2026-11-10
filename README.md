# Zero The Legend — Render Bot Engine

This branch separates the v6.28 control panel from the bot runtime.

- `userscripts/Zero-The-Legend-v6.28-Render.user.js`: v6.28 menu/control panel; it sends authenticated commands and mouse coordinates to Render.
- `server.js`: HTTPS API, WSS control channel, license verification and health endpoint.
- `core/BotEngine.js`: one persistent session manager per verified license.
- `core/Minion.js`: server-side port of the v6.28 bot connection/protocol engine.
- `core/Client.js`: panel connection adapter only; it does not create or own bots.

## Render configuration

Set these environment variables in the Render service:

| Variable | Required | Purpose |
|---|---:|---|
| `LICENSE_TOKEN_SECRET` | Yes | Random secret, at least 32 characters, used to sign short-lived access tokens |
| `DB_HOST`, `DB_USER`, `DB_NAME` | Yes* | MySQL license database connection |
| `DB_PASSWORD` | Yes* | MySQL password |
| `DB_PORT` | No | Defaults to 3306 |
| `DB_SSL` | No | Set to `true` when the database requires verified TLS |
| `MYSQL_URL` | Alternative | MySQL connection URL instead of individual DB variables |
| `GAME_SERVER_ALLOWLIST` | Yes | Comma-separated exact hostnames of private/explicitly authorized WSS game servers |
| `MAX_BOTS_PER_SESSION` | No | Global per-session cap; defaults to 40 |
| `BOT_RECONNECT_ATTEMPTS` | No | Reconnect attempt cap; defaults to 8 |
| `CORS_ORIGINS` | Recommended | Comma-separated browser origins allowed to call the API |

*Use either `MYSQL_URL` or the individual `DB_*` variables. The license table must contain `license_key`, `is_active`, `expire_date`, and `max_bots` columns.

`GAME_SERVER_ALLOWLIST` accepts hostnames only, not URLs. The engine rejects non-WSS URLs and any host not explicitly listed. Do not add public game hosts unless you own or are expressly authorized to operate that server.

## Render commands

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Syntax check: `npm run check`

## API overview

- `POST /api/verify-license`: validates a license key and returns a short-lived bearer token.
- `POST /api/sync`: start, stop, or update the authenticated bot session.
- `GET /api/status`: returns the authenticated session status.
- `POST /api/command`: split, eject, or reconnect commands.
- `WSS /ws`: authenticate with the first JSON message `{ "type": "auth", "token": "..." }`; then send binary opcode-16 coordinate packets.

The bot session is owned by the backend, not by the panel socket. Closing the browser or losing WSS does not stop the session. An explicit stop command, license expiry/revocation, or Render process shutdown does.

## Important deployment note

The Render service needs the same MySQL license data used by the portal. If the DB is not configured, license verification fails closed and bot commands are rejected. Sessions are held in process memory: a Render restart or redeploy stops active sessions.

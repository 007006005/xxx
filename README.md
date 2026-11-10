# Zero The Legend — Render Bot Engine

This branch separates the v6.28 control panel from the bot runtime.

- `userscripts/Zero-The-Legend-v6.28-Render.user.js`: v6.28 menu/control panel; it sends authenticated commands and mouse coordinates to Render.
- `server.js`: HTTPS API, WSS control channel, license verification and health endpoint.
- `core/BotEngine.js`: one persistent session manager per verified license.
- `core/Minion.js`: server-side port of the v6.28 bot connection/protocol engine.
- `core/Client.js`: panel connection adapter only; it does not create or own bots.

## Render configuration

The userscript does not contain a hard-coded Render hostname. Set `window.ZERO_ENGINE_HTTP_URL` in a trusted page bootstrap/configuration you control (for example `https://your-render-service.onrender.com`). If it is absent, all Render calls remain disabled. The WebSocket URL is derived from this HTTPS base.

Set these environment variables in the Render service:

| Variable | Required | Purpose |
|---|---:|---|
| `LICENSE_TOKEN_SECRET` | Yes | Random secret, at least 32 characters, used to sign short-lived access tokens |
| `DB_HOST`, `DB_USER`, `DB_NAME` | Yes* | MySQL license database connection |
| `DB_PASSWORD` | Yes* | MySQL password |
| `DB_PORT` | No | Defaults to 3306 |
| `DB_SSL` | No | Set to `true` when the database requires verified TLS |
| `MYSQL_URL` | Alternative | MySQL connection URL instead of individual DB variables |
| `GAME_SERVER_ALLOWLIST` | Yes | Comma-separated private, explicitly authorized server hostnames; public game domains are rejected |
| `MAX_BOTS_PER_SESSION` | No | Global per-session cap; defaults to 40 |
| `BOT_RECONNECT_ATTEMPTS` | No | Reconnect attempt cap; defaults to 8 |
| `CORS_ORIGINS` | Recommended | Comma-separated browser origins allowed to call the API; defaults to the eight HTTPS origins for Agar.io, Delt.io, Agar.cc, and Agar.su |

*Use either `MYSQL_URL` or the individual `DB_*` variables. The license table must contain `license_key`, `is_active`, `expire_date`, and `max_bots` columns.

`GAME_SERVER_ALLOWLIST` accepts domain names only, not URLs. Configure the exact private server hostname supplied by the server operator; do not put `agar.io`, `delt.io`, `agar.cc`, or `agar.su` in `GAME_SERVER_ALLOWLIST`. Those public game services are deliberately blocked for bot connections. Example (replace with your own private hostname):

```text
GAME_CONNECTIONS_ENABLED=false
GAME_SERVER_ALLOWLIST=game.example.net
CORS_ORIGINS=https://agar.io,https://www.agar.io,https://delt.io,https://www.delt.io,https://agar.cc,https://www.agar.cc,https://agar.su,https://www.agar.su
```

Set `GAME_CONNECTIONS_ENABLED=true` only after confirming that the hostname is a private server you control or one that explicitly authorizes automated clients. The backend requires WSS and an exact root/subdomain boundary match. The userscript has separate local settings for each of the four page domains.

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

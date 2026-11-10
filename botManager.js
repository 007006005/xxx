import express from "express";

export default function createBotManagerRouter({ engine, requireLicense }) {
  const router = express.Router();
  router.use(requireLicense);

  function botOptions(body, license) {
    return {
      botCount: body.botCount,
      botNames: typeof body.botName === "string"
        ? body.botName.split(",").map((name) => name.trim()).filter(Boolean)
        : body.botNames,
      agarServer: body.agarServer,
      spawnPointActive: body.spawnPointActive,
      spawnPointX: body.spawnPointX,
      spawnPointY: body.spawnPointY,
      botAi: body.botAi,
      botOPK: body.botOPK,
      vShield: body.vShield,
      freezeBots: body.freezeBots,
      patrolMode: body.patrolMode,
      tricksplitActive: body.tricksplitActive,
      targetNickname: body.targetNickname,
      licenseMaxBots: license.maxBots,
    };
  }

  router.post("/sync", (req, res) => {
    try {
      const body = req.body || {};
      const action = body.action || "sync_bots";
      let result;

      if (action === "start") {
        result = engine.start(req.ownerId, botOptions(body, req.license));
      } else if (action === "stop") {
        engine.stop(req.ownerId);
        result = engine.status(req.ownerId);
      } else if (action === "command") {
        result = engine.command(req.ownerId, body.command);
      } else if (action === "sync_bots") {
        const current = engine.status(req.ownerId);
        if (current.isRunning) {
          result = engine.update(req.ownerId, botOptions(body, req.license));
        } else {
          result = current;
        }
      } else {
        return res.status(400).json({ error: "Azione non valida" });
      }

      return res.json({ success: true, ...result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  router.post("/start", (req, res) => {
    try {
      const result = engine.start(req.ownerId, botOptions(req.body || {}, req.license));
      return res.json({ success: true, ...result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  router.post("/command", (req, res) => {
    try {
      const result = engine.command(req.ownerId, req.body?.command);
      return res.json({ success: true, ...result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  router.post("/stop", (req, res) => {
    engine.stop(req.ownerId);
    return res.json({ success: true, ...engine.status(req.ownerId) });
  });

  router.get("/status", (req, res) => {
    return res.json(engine.status(req.ownerId));
  });

  return router;
}

// Funzione di forzatura assoluta sul socket di gioco attivo
  function forceDirectAction(actionType) {
    // actionType: 17 = Split, 21 = Feed
    const packet = new Uint8Array([actionType]).buffer;
    let success = false;

    // 1. Invia al backend Render per i bot
    if (actionType === 17) {
      sendToXev(buildPacket1(4), "FORCED_SPLIT");
    } else if (actionType === 21) {
      sendToXev(buildPacket1(3), "FORCED_FEED");
    }

    // 2. Invia direttamente a TUTTI i socket di gioco catturati
    const all = win._zeroAllSockets || [];
    for (let i = 0; i < all.length; i++) {
      try {
        const ws = all[i];
        if (ws && ws.readyState === 1) {
          const u = (ws.url || "").toLowerCase();
          if (u.indexOf("render.com") === -1 && u.indexOf("localhost") === -1) {
            ws.send(packet);
            success = true;
          }
        }
      } catch (e) {}
    }

    // 3. Fallback sul socket principale registrato
    if (!success && win._zeroWs && win._zeroWs.readyState === 1) {
      try {
        win._zeroWs.send(packet);
        success = true;
      } catch (e) {}
    }

    console.log(`⚡ [ZERO FORCED ACTION] Tipo ${actionType} -> Inviato:`, success);
    if (actionType === 17) SFX.split();
    else SFX.feed();
  }

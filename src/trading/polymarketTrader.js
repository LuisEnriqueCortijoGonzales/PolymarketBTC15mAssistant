function normalizeSide(side) {
  const s = String(side || "").toUpperCase();
  if (s === "UP" || s === "BUY_UP_FAST_SELL_HIGH") return "UP";
  if (s === "DOWN" || s === "BUY_DOWN_FAST_SELL_HIGH") return "DOWN";
  return null;
}

export function createPolymarketTrader(cfg = {}) {
  const enabled = Boolean(cfg.enabled);
  const dryRun = cfg.dryRun !== false;
  const apiUrl = String(cfg.apiUrl || "https://clob.polymarket.com").replace(/\/$/, "");
  const apiKey = String(cfg.apiKey || "");
  const apiSecret = String(cfg.apiSecret || "");
  const apiPassphrase = String(cfg.apiPassphrase || "");
  const defaultSizeUsd = Number(cfg.defaultSizeUsd || 15);

  async function placeScalpOrder({ marketSlug, tokenId, side, maxPriceCents, sizeUsd, note, metadata } = {}) {
    const normalizedSide = normalizeSide(side);
    if (!enabled || !normalizedSide || !tokenId) {
      return { ok: false, skipped: true, reason: "trading_not_enabled_or_missing_data" };
    }

    const payload = {
      market: marketSlug ?? null,
      token_id: String(tokenId),
      side: "buy",
      outcome: normalizedSide === "UP" ? "UP" : "DOWN",
      order_type: "market",
      size_usd: Number.isFinite(Number(sizeUsd)) ? Number(sizeUsd) : defaultSizeUsd,
      max_price_cents: Number.isFinite(Number(maxPriceCents)) ? Number(maxPriceCents) : null,
      note: note ?? null,
      metadata: metadata ?? null,
      ts: Date.now()
    };

    if (dryRun) {
      return { ok: true, dryRun: true, payload };
    }

    const headers = {
      "content-type": "application/json"
    };

    if (apiKey) headers["X-API-KEY"] = apiKey;
    if (apiSecret) headers["X-API-SECRET"] = apiSecret;
    if (apiPassphrase) headers["X-API-PASSPHRASE"] = apiPassphrase;

    const tryPaths = ["/orders", "/order"];
    let lastErr = null;

    for (const path of tryPaths) {
      try {
        const res = await fetch(`${apiUrl}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });

        const text = await res.text();
        if (!res.ok) {
          lastErr = `http_${res.status}:${text.slice(0, 200)}`;
          continue;
        }

        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }

        return { ok: true, dryRun: false, endpoint: path, payload, data };
      } catch (err) {
        lastErr = err?.message ?? String(err);
      }
    }

    return { ok: false, dryRun: false, payload, error: lastErr ?? "unknown_order_error" };
  }

  return {
    enabled,
    dryRun,
    defaultSizeUsd,
    placeScalpOrder
  };
}

import { appendCsvRow } from "../utils.js";

function normalizeOutcome(side) {
  const s = String(side || "").toUpperCase();
  if (s === "UP" || s === "BUY_UP_FAST_SELL_HIGH") return "UP";
  if (s === "DOWN" || s === "BUY_DOWN_FAST_SELL_HIGH") return "DOWN";
  return null;
}

export function createPolymarketTrader(cfg = {}) {
  const realEnabled = Boolean(cfg.enabled);
  const dryRun = cfg.dryRun !== false;
  const simulationMode = !realEnabled || dryRun;
  const apiUrl = String(cfg.apiUrl || "https://clob.polymarket.com").replace(/\/$/, "");
  const apiKey = String(cfg.apiKey || "");
  const apiSecret = String(cfg.apiSecret || "");
  const apiPassphrase = String(cfg.apiPassphrase || "");
  const defaultSizeUsd = Number(cfg.defaultSizeUsd || 1);

  function record({ mode, marketSlug, tokenId, action, outcome, sizeUsd, maxPriceCents, reason, status, details }) {
    appendCsvRow("./logs/trade_execution_log.csv", [
      "ts",
      "mode",
      "market_slug",
      "token_id",
      "action",
      "outcome",
      "size_usd",
      "max_price_cents",
      "reason",
      "status",
      "details"
    ], [
      new Date().toISOString(),
      mode,
      marketSlug,
      tokenId,
      action,
      outcome,
      sizeUsd,
      maxPriceCents,
      reason,
      status,
      details
    ]);
  }

  async function placeOrder({ marketSlug, tokenId, action = "buy", side, maxPriceCents, sizeUsd, reason = "", metadata } = {}) {
    const outcome = normalizeOutcome(side);
    const act = String(action || "buy").toLowerCase() === "sell" ? "sell" : "buy";
    if (!outcome || !tokenId) {
      return { ok: false, skipped: true, reason: "missing_side_or_token" };
    }

    const payload = {
      market: marketSlug ?? null,
      token_id: String(tokenId),
      side: act,
      outcome,
      order_type: "market",
      size_usd: Number.isFinite(Number(sizeUsd)) ? Number(sizeUsd) : defaultSizeUsd,
      max_price_cents: Number.isFinite(Number(maxPriceCents)) ? Number(maxPriceCents) : null,
      reason,
      metadata: metadata ?? null,
      ts: Date.now()
    };

    if (simulationMode) {
      record({
        mode: realEnabled ? "dry_run" : "simulated",
        marketSlug,
        tokenId,
        action: act,
        outcome,
        sizeUsd: payload.size_usd,
        maxPriceCents: payload.max_price_cents,
        reason,
        status: "ok",
        details: "simulated_order"
      });
      return { ok: true, simulated: true, payload };
    }

    const headers = { "content-type": "application/json" };
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

        record({
          mode: "live",
          marketSlug,
          tokenId,
          action: act,
          outcome,
          sizeUsd: payload.size_usd,
          maxPriceCents: payload.max_price_cents,
          reason,
          status: "ok",
          details: path
        });

        return { ok: true, simulated: false, endpoint: path, payload, response: text };
      } catch (err) {
        lastErr = err?.message ?? String(err);
      }
    }

    record({
      mode: "live",
      marketSlug,
      tokenId,
      action: act,
      outcome,
      sizeUsd: payload.size_usd,
      maxPriceCents: payload.max_price_cents,
      reason,
      status: "error",
      details: lastErr ?? "unknown_order_error"
    });

    return { ok: false, simulated: false, payload, error: lastErr ?? "unknown_order_error" };
  }

  return {
    realEnabled,
    dryRun,
    simulationMode,
    defaultSizeUsd,
    placeOrder
  };
}

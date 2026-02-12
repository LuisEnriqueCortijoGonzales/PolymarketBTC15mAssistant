import { CONFIG } from "./config.js";
import { fetchKlines, fetchLastPrice } from "./data/binance.js";
import { fetchChainlinkUsd } from "./data/chainlink.js";
import { startChainlinkPriceStream } from "./data/chainlinkWs.js";
import { startPolymarketChainlinkPriceStream } from "./data/polymarketLiveWs.js";
import {
  fetchMarketBySlug,
  fetchLiveMarketsForCoin,
  pickLatestLiveMarket,
  fetchClobPrice,
  fetchOrderBook,
  summarizeOrderBook
} from "./data/polymarket.js";
import { computeSessionVwap, computeVwapSeries } from "./indicators/vwap.js";
import { computeRsi, sma, slopeLast } from "./indicators/rsi.js";
import { computeMacd } from "./indicators/macd.js";
import { computeHeikenAshi, countConsecutive } from "./indicators/heikenAshi.js";
import { detectRegime } from "./engines/regime.js";
import { scoreDirection, applyTimeAwareness } from "./engines/probability.js";
import { computeEdge, decide } from "./engines/edge.js";
import { estimateSigmaFromBinanceCloses, probUpLognormal, blendProbabilities } from "./engines/quantModel.js";
import { appendCsvRow, formatNumber, formatPct, getCandleWindowTiming, sleep } from "./utils.js";
import { startBinanceTradeStream } from "./data/binanceWs.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { applyGlobalProxyFromEnv } from "./net/proxy.js";

function countVwapCrosses(closes, vwapSeries, lookback) {
  if (closes.length < lookback || vwapSeries.length < lookback) return null;
  let crosses = 0;
  for (let i = closes.length - lookback + 1; i < closes.length; i += 1) {
    const prev = closes[i - 1] - vwapSeries[i - 1];
    const cur = closes[i] - vwapSeries[i];
    if (prev === 0) continue;
    if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) crosses += 1;
  }
  return crosses;
}

applyGlobalProxyFromEnv();

function fmtTimeLeft(mins) {
  const totalSeconds = Math.max(0, Math.floor(mins * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  lightRed: "\x1b[91m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  dim: "\x1b[2m"
};

function screenWidth() {
  const w = Number(process.stdout?.columns);
  return Number.isFinite(w) && w >= 40 ? w : 80;
}

function sepLine(ch = "─") {
  const w = screenWidth();
  return `${ANSI.white}${ch.repeat(w)}${ANSI.reset}`;
}

function renderScreen(text) {
  try {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  } catch {
    // ignore
  }
  process.stdout.write(text);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

function padLabel(label, width) {
  const visible = stripAnsi(label).length;
  if (visible >= width) return label;
  return label + " ".repeat(width - visible);
}

function centerText(text, width) {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  const left = Math.floor((width - visible) / 2);
  const right = width - visible - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

const LABEL_W = 12;
function kv(label, value) {
  const l = padLabel(String(label), LABEL_W);
  return `${l}${value}`;
}

function section(title) {
  return `${ANSI.white}${title}${ANSI.reset}`;
}

function colorPriceLine({ label, price, prevPrice, decimals = 0, prefix = "" }) {
  if (price === null || price === undefined) {
    return `${label}: ${ANSI.gray}-${ANSI.reset}`;
  }

  const p = Number(price);
  const prev = prevPrice === null || prevPrice === undefined ? null : Number(prevPrice);

  let color = ANSI.reset;
  let arrow = "";
  if (prev !== null && Number.isFinite(prev) && Number.isFinite(p) && p !== prev) {
    if (p > prev) {
      color = ANSI.green;
      arrow = " ↑";
    } else {
      color = ANSI.red;
      arrow = " ↓";
    }
  }

  const formatted = `${prefix}${formatNumber(p, decimals)}`;
  return `${label}: ${color}${formatted}${arrow}${ANSI.reset}`;
}

function formatSignedDelta(delta, base) {
  if (delta === null || base === null || base === 0) return `${ANSI.gray}-${ANSI.reset}`;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const pct = (Math.abs(delta) / Math.abs(base)) * 100;
  return `${sign}$${Math.abs(delta).toFixed(2)}, ${sign}${pct.toFixed(2)}%`;
}

function colorByNarrative(text, narrative) {
  if (narrative === "LONG") return `${ANSI.green}${text}${ANSI.reset}`;
  if (narrative === "SHORT") return `${ANSI.red}${text}${ANSI.reset}`;
  return `${ANSI.gray}${text}${ANSI.reset}`;
}

function formatNarrativeValue(label, value, narrative) {
  return `${label}: ${colorByNarrative(value, narrative)}`;
}

function narrativeFromSign(x) {
  if (x === null || x === undefined || !Number.isFinite(Number(x)) || Number(x) === 0) return "NEUTRAL";
  return Number(x) > 0 ? "LONG" : "SHORT";
}

function narrativeFromRsi(rsi) {
  if (rsi === null || rsi === undefined || !Number.isFinite(Number(rsi))) return "NEUTRAL";
  const v = Number(rsi);
  if (v >= 55) return "LONG";
  if (v <= 45) return "SHORT";
  return "NEUTRAL";
}

function narrativeFromSlope(slope) {
  if (slope === null || slope === undefined || !Number.isFinite(Number(slope)) || Number(slope) === 0) return "NEUTRAL";
  return Number(slope) > 0 ? "LONG" : "SHORT";
}



function computePolyFutureProjection({
  marketUp,
  marketDown,
  chainlinkPrice,
  binancePrice,
  priceToBeat,
  sigma,
  tSec,
  wModel = 0.7
}) {
  const mUp = Number(marketUp);
  const mDown = Number(marketDown);
  const s = Number(chainlinkPrice);
  const b = Number(binancePrice);
  const k = Number(priceToBeat);
  const t = Number(tSec);
  const sig = Number(sigma);

  const hasMarket = Number.isFinite(mUp) || Number.isFinite(mDown);
  const marketUpProb = Number.isFinite(mUp)
    ? (mUp > 1 ? mUp / 100 : mUp)
    : Number.isFinite(mDown)
      ? (mDown > 1 ? 1 - (mDown / 100) : 1 - mDown)
      : null;

  if (!Number.isFinite(s) || !Number.isFinite(k) || !Number.isFinite(t) || t <= 0 || !Number.isFinite(sig) || sig <= 0) {
    return {
      ok: false,
      marketUpProb,
      futureUpProb: null,
      futureUpCents: null,
      edgeVsMarketUpCents: null,
      strategy: hasMarket ? "HOLD" : "N/A"
    };
  }

  const basis = (Number.isFinite(b) && s !== 0) ? ((b - s) / s) : 0;
  const basisImpact = Math.max(-0.01, Math.min(0.01, basis * 0.35));
  const sAdjusted = s * (1 + basisImpact);

  const quant = probUpLognormal(sAdjusted, k, Math.max(1, t), sig);
  if (!quant) {
    return {
      ok: false,
      marketUpProb,
      futureUpProb: null,
      futureUpCents: null,
      edgeVsMarketUpCents: null,
      strategy: hasMarket ? "HOLD" : "N/A"
    };
  }

  const modelUp = quant.pUp;
  const futureUpProb = marketUpProb === null
    ? modelUp
    : (wModel * modelUp) + ((1 - wModel) * marketUpProb);

  const clamped = Math.max(0.001, Math.min(0.999, futureUpProb));
  const futureUpCents = clamped * 100;
  const edgeVsMarketUpCents = marketUpProb === null ? null : (futureUpCents - (marketUpProb * 100));

  let strategy = "HOLD";
  if (edgeVsMarketUpCents !== null) {
    if (edgeVsMarketUpCents >= 2.5) strategy = "BUY_UP_FAST";
    else if (edgeVsMarketUpCents <= -2.5) strategy = "BUY_DOWN_FAST";
  }

  return {
    ok: true,
    marketUpProb,
    futureUpProb: clamped,
    futureUpCents,
    edgeVsMarketUpCents,
    strategy
  };
}

function formatProbPct(p, digits = 0) {
  if (p === null || p === undefined || !Number.isFinite(Number(p))) return "-";
  return `${(Number(p) * 100).toFixed(digits)}%`;
}

function fmtEtTime(now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
  } catch {
    return "-";
  }
}

function getBtcSession(now = new Date()) {
  const h = now.getUTCHours();
  const inAsia = h >= 0 && h < 8;
  const inEurope = h >= 7 && h < 16;
  const inUs = h >= 13 && h < 22;

  if (inEurope && inUs) return "Solape Europa/EE. UU.";
  if (inAsia && inEurope) return "Solape Asia/Europa";
  if (inAsia) return "Sesión Asia";
  if (inEurope) return "Sesión Europa";
  if (inUs) return "Sesión EE. UU.";
  return "Fuera de sesión";
}

function parsePriceToBeat(market) {
  const text = String(market?.question ?? market?.title ?? "");
  if (!text) return null;
  const m = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const raw = m[1].replace(/,/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const dumpedMarkets = new Set();

function safeFileSlug(x) {
  return String(x ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

function extractNumericFromMarket(market) {
  const directKeys = [
    "priceToBeat",
    "price_to_beat",
    "strikePrice",
    "strike_price",
    "strike",
    "threshold",
    "thresholdPrice",
    "threshold_price",
    "targetPrice",
    "target_price",
    "referencePrice",
    "reference_price"
  ];

  for (const k of directKeys) {
    const v = market?.[k];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return n;
  }

  const seen = new Set();
  const stack = [{ obj: market, depth: 0 }];

  while (stack.length) {
    const { obj, depth } = stack.pop();
    if (!obj || typeof obj !== "object") continue;
    if (seen.has(obj) || depth > 6) continue;
    seen.add(obj);

    const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
    for (const [key, value] of entries) {
      const k = String(key).toLowerCase();
      if (value && typeof value === "object") {
        stack.push({ obj: value, depth: depth + 1 });
        continue;
      }

      if (!/(price|strike|threshold|target|beat)/i.test(k)) continue;

      const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
      if (!Number.isFinite(n)) continue;

      if (n > 1000 && n < 2_000_000) return n;
    }
  }

  return null;
}

function priceToBeatFromPolymarketMarket(market) {
  const n = extractNumericFromMarket(market);
  if (n !== null) return n;
  return parsePriceToBeat(market);
}

const marketCache = {
  market: null,
  fetchedAtMs: 0
};

async function resolveCurrentCoin15mMarket() {
  if (CONFIG.polymarket.marketSlug) {
    return await fetchMarketBySlug(CONFIG.polymarket.marketSlug);
  }

  if (!CONFIG.polymarket.autoSelectLatest) return null;

  const now = Date.now();
  if (marketCache.market && now - marketCache.fetchedAtMs < CONFIG.pollIntervalMs) {
    return marketCache.market;
  }

  const markets = await fetchLiveMarketsForCoin({
    slugPrefix: CONFIG.polymarket.slugPrefix,
    seriesSlug: CONFIG.polymarket.seriesSlug
  });
  const picked = pickLatestLiveMarket(markets);

  marketCache.market = picked;
  marketCache.fetchedAtMs = now;
  return picked;
}

async function fetchPolymarketSnapshot() {
  const market = await resolveCurrentCoin15mMarket();

  if (!market) return { ok: false, reason: "market_not_found" };

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : (typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : []);
  const outcomePrices = Array.isArray(market.outcomePrices)
    ? market.outcomePrices
    : (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : []);

  const clobTokenIds = Array.isArray(market.clobTokenIds)
    ? market.clobTokenIds
    : (typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : []);

  let upTokenId = null;
  let downTokenId = null;
  for (let i = 0; i < outcomes.length; i += 1) {
    const label = String(outcomes[i]);
    const tokenId = clobTokenIds[i] ? String(clobTokenIds[i]) : null;
    if (!tokenId) continue;

    if (label.toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase()) upTokenId = tokenId;
    if (label.toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase()) downTokenId = tokenId;
  }

  const upIndex = outcomes.findIndex((x) => String(x).toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase());
  const downIndex = outcomes.findIndex((x) => String(x).toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase());

  const gammaYes = upIndex >= 0 ? Number(outcomePrices[upIndex]) : null;
  const gammaNo = downIndex >= 0 ? Number(outcomePrices[downIndex]) : null;

  if (!upTokenId || !downTokenId) {
    return {
      ok: false,
      reason: "missing_token_ids",
      market,
      outcomes,
      clobTokenIds,
      outcomePrices
    };
  }

  let upBuy = null;
  let downBuy = null;
  let upBookSummary = { bestBid: null, bestAsk: null, spread: null, bidLiquidity: null, askLiquidity: null };
  let downBookSummary = { bestBid: null, bestAsk: null, spread: null, bidLiquidity: null, askLiquidity: null };

  try {
    const [yesBuy, noBuy, upBook, downBook] = await Promise.all([
      fetchClobPrice({ tokenId: upTokenId, side: "buy" }),
      fetchClobPrice({ tokenId: downTokenId, side: "buy" }),
      fetchOrderBook({ tokenId: upTokenId }),
      fetchOrderBook({ tokenId: downTokenId })
    ]);

    upBuy = yesBuy;
    downBuy = noBuy;
    upBookSummary = summarizeOrderBook(upBook);
    downBookSummary = summarizeOrderBook(downBook);
  } catch {
    upBuy = null;
    downBuy = null;
    upBookSummary = {
      bestBid: Number(market.bestBid) || null,
      bestAsk: Number(market.bestAsk) || null,
      spread: Number(market.spread) || null,
      bidLiquidity: null,
      askLiquidity: null
    };
    downBookSummary = {
      bestBid: null,
      bestAsk: null,
      spread: Number(market.spread) || null,
      bidLiquidity: null,
      askLiquidity: null
    };
  }

  return {
    ok: true,
    market,
    tokens: { upTokenId, downTokenId },
    prices: {
      up: upBuy ?? gammaYes,
      down: downBuy ?? gammaNo
    },
    orderbook: {
      up: upBookSummary,
      down: downBookSummary
    }
  };
}

async function main() {
  const binanceStream = startBinanceTradeStream({ symbol: CONFIG.symbol });
  const polymarketLiveStream = startPolymarketChainlinkPriceStream({ symbolIncludes: CONFIG.polymarket.livePriceSymbolIncludes });
  const chainlinkStream = startChainlinkPriceStream({ aggregator: CONFIG.chainlink.usdAggregator, decimals: CONFIG.chainlink.decimals });

  let prevSpotPrice = null;
  let prevCurrentPrice = null;
  let priceToBeatState = { slug: null, value: null, setAtMs: null };
  let netErrorStreak = 0;
  let lastErrorSig = "";
  let lastErrorLogAt = 0;


  const header = [
    "timestamp",
    "entry_minute",
    "time_left_min",
    "regime",
    "signal",
    "model_up",
    "model_down",
    "mkt_up",
    "mkt_down",
    "edge_up",
    "edge_down",
    "recommendation",
    "poly_future_up_cents",
    "poly_future_edge_cents",
    "poly_future_strategy"
  ];

  while (true) {
    const loopStartMs = Date.now();
    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);

    const wsTick = binanceStream.getLast();
    const wsPrice = wsTick?.price ?? null;

    const polymarketWsTick = polymarketLiveStream.getLast();
    const polymarketWsPrice = polymarketWsTick?.price ?? null;

    const chainlinkWsTick = chainlinkStream.getLast();
    const chainlinkWsPrice = chainlinkWsTick?.price ?? null;

    try {
      const chainlinkPromise = polymarketWsPrice !== null
        ? Promise.resolve({ price: polymarketWsPrice, updatedAt: polymarketWsTick?.updatedAt ?? null, source: "polymarket_ws" })
        : chainlinkWsPrice !== null
          ? Promise.resolve({ price: chainlinkWsPrice, updatedAt: chainlinkWsTick?.updatedAt ?? null, source: "chainlink_ws" })
          : fetchChainlinkUsd();

      const [klines1m, klines5m, lastPrice, chainlink, poly] = await Promise.all([
        fetchKlines({ interval: "1m", limit: 240 }),
        fetchKlines({ interval: "5m", limit: 200 }),
        fetchLastPrice(),
        chainlinkPromise,
        fetchPolymarketSnapshot()
      ]);

      const settlementMs = poly.ok && poly.market?.endDate ? new Date(poly.market.endDate).getTime() : null;
      const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;

      const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;

      const candles = klines1m;
      const closes = candles.map((c) => c.close);

      const vwap = computeSessionVwap(candles);
      const vwapSeries = computeVwapSeries(candles);
      const vwapNow = vwapSeries[vwapSeries.length - 1];

      const lookback = CONFIG.vwapSlopeLookbackMinutes;
      const vwapSlope = vwapSeries.length >= lookback ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback : null;
      const vwapDist = vwapNow ? (lastPrice - vwapNow) / vwapNow : null;

      const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
      const rsiSeries = [];
      for (let i = 0; i < closes.length; i += 1) {
        const sub = closes.slice(0, i + 1);
        const r = computeRsi(sub, CONFIG.rsiPeriod);
        if (r !== null) rsiSeries.push(r);
      }
      const rsiMa = sma(rsiSeries, CONFIG.rsiMaPeriod);
      const rsiSlope = slopeLast(rsiSeries, 3);

      const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);

      const ha = computeHeikenAshi(candles);
      const consec = countConsecutive(ha);

      const vwapCrossCount = countVwapCrosses(closes, vwapSeries, 20);
      const volumeRecent = candles.slice(-20).reduce((a, c) => a + c.volume, 0);
      const volumeAvg = candles.slice(-120).reduce((a, c) => a + c.volume, 0) / 6;

      const failedVwapReclaim = vwapNow !== null && vwapSeries.length >= 3
        ? closes[closes.length - 1] < vwapNow && closes[closes.length - 2] > vwapSeries[vwapSeries.length - 2]
        : false;

      const regimeInfo = detectRegime({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        vwapCrossCount,
        volumeRecent,
        volumeAvg
      });

      const scored = scoreDirection({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        rsi: rsiNow,
        rsiSlope,
        macd,
        heikenColor: consec.color,
        heikenCount: consec.count,
        failedVwapReclaim
      });

      const timeAware = applyTimeAwareness(scored.rawUp, timeLeftMin, CONFIG.candleWindowMinutes);

      const marketUp = poly.ok ? poly.prices.up : null;
      const marketDown = poly.ok ? poly.prices.down : null;

      const vwapSlopeLabel = vwapSlope === null ? "-" : vwapSlope > 0 ? "UP" : vwapSlope < 0 ? "DOWN" : "FLAT";

      const macdLabel = macd === null
        ? "-"
        : macd.hist < 0
          ? (macd.histDelta !== null && macd.histDelta < 0 ? "bajista (acelerando)" : "bajista")
          : (macd.histDelta !== null && macd.histDelta > 0 ? "alcista (acelerando)" : "alcista");

      const lastCandle = klines1m.length ? klines1m[klines1m.length - 1] : null;
      const lastClose = lastCandle?.close ?? null;
      const close1mAgo = klines1m.length >= 2 ? klines1m[klines1m.length - 2]?.close ?? null : null;
      const close3mAgo = klines1m.length >= 4 ? klines1m[klines1m.length - 4]?.close ?? null : null;
      const delta1m = lastClose !== null && close1mAgo !== null ? lastClose - close1mAgo : null;
      const delta3m = lastClose !== null && close3mAgo !== null ? lastClose - close3mAgo : null;

      const haNarrative = (consec.color ?? "").toLowerCase() === "green" ? "LONG" : (consec.color ?? "").toLowerCase() === "red" ? "SHORT" : "NEUTRAL";
      const rsiNarrative = narrativeFromSlope(rsiSlope);
      const macdNarrative = narrativeFromSign(macd?.hist ?? null);
      const vwapNarrative = narrativeFromSign(vwapDist);

      let pLong = null;
      let pShort = null;
      let predictValue = `${ANSI.green}LONG${ANSI.reset} ${ANSI.green}${formatProbPct(pLong, 0)}${ANSI.reset} / ${ANSI.red}SHORT${ANSI.reset} ${ANSI.red}${formatProbPct(pShort, 0)}${ANSI.reset}`;
      const marketUpStr = `${marketUp ?? "-"}${marketUp === null || marketUp === undefined ? "" : "¢"}`;
      const marketDownStr = `${marketDown ?? "-"}${marketDown === null || marketDown === undefined ? "" : "¢"}`;
      const polyHeaderValue = `${ANSI.green}↑ SUBE${ANSI.reset} ${marketUpStr}  |  ${ANSI.red}↓ BAJA${ANSI.reset} ${marketDownStr}`;

      const heikenValue = `${consec.color ?? "-"} x${consec.count}`;
      const heikenLine = formatNarrativeValue("Heikin Ashi", heikenValue, haNarrative);

      const rsiArrow = rsiSlope !== null && rsiSlope < 0 ? "↓" : rsiSlope !== null && rsiSlope > 0 ? "↑" : "-";
      const rsiValue = `${formatNumber(rsiNow, 1)} ${rsiArrow}`;
      const rsiLine = formatNarrativeValue("RSI", rsiValue, rsiNarrative);

      const macdLine = formatNarrativeValue("MACD", macdLabel, macdNarrative);

      const delta1Narrative = narrativeFromSign(delta1m);
      const delta3Narrative = narrativeFromSign(delta3m);
      const deltaValue = `${colorByNarrative(formatSignedDelta(delta1m, lastClose), delta1Narrative)} | ${colorByNarrative(formatSignedDelta(delta3m, lastClose), delta3Narrative)}`;
      const deltaLine = `Variación 1/3 min: ${deltaValue}`;

      const vwapValue = `${formatNumber(vwapNow, 0)} (${formatPct(vwapDist, 2)}) | slope: ${vwapSlopeLabel}`;
      const vwapLine = formatNarrativeValue("VWAP", vwapValue, vwapNarrative);

      let signal = "SIN OPERACIÓN";

      const spreadUp = poly.ok ? poly.orderbook.up.spread : null;
      const spreadDown = poly.ok ? poly.orderbook.down.spread : null;

      const spread = spreadUp !== null && spreadDown !== null ? Math.max(spreadUp, spreadDown) : (spreadUp ?? spreadDown);
      const liquidity = poly.ok
        ? (Number(poly.market?.liquidityNum) || Number(poly.market?.liquidity) || null)
        : null;

      const spotPrice = wsPrice ?? lastPrice;
      const currentPrice = chainlink?.price ?? null;
      const marketSlug = poly.ok ? String(poly.market?.slug ?? "") : "";
      const marketStartMs = poly.ok && poly.market?.eventStartTime ? new Date(poly.market.eventStartTime).getTime() : null;

      if (marketSlug && priceToBeatState.slug !== marketSlug) {
        priceToBeatState = { slug: marketSlug, value: null, setAtMs: null };
      }

      if (priceToBeatState.slug && priceToBeatState.value === null && currentPrice !== null) {
        const nowMs = Date.now();
        const okToLatch = marketStartMs === null ? true : nowMs >= marketStartMs;
        if (okToLatch) {
          priceToBeatState = { slug: priceToBeatState.slug, value: Number(currentPrice), setAtMs: nowMs };
        }
      }

      const priceToBeat = priceToBeatState.slug === marketSlug ? priceToBeatState.value : null;
      const binanceVsStrikeShort = (spotPrice !== null && priceToBeat !== null) ? `${(spotPrice - priceToBeat) >= 0 ? "+" : "-"}$${Math.abs(spotPrice - priceToBeat).toFixed(2)}` : "-";
      const tSec = Math.max(1, Math.floor((timeLeftMin ?? 0) * 60));
      const sigmaRaw = estimateSigmaFromBinanceCloses(closes, CONFIG.quant.sigmaLookbackMinutes, CONFIG.quant.minSamples);
      const sigma = sigmaRaw ?? (CONFIG.quant.sigmaMin > 0 ? CONFIG.quant.sigmaMin : null);
      const quant = probUpLognormal(currentPrice, priceToBeat, tSec, sigma);
      const blended = blendProbabilities(quant?.pUp ?? null, timeAware?.adjustedUp ?? null, CONFIG.quant.wQuant);

      const modelUp = blended?.pUp ?? null;
      const modelDown = blended?.pDown ?? null;

      const edge = computeEdge({ modelUp, modelDown, marketYes: marketUp, marketNo: marketDown });
      let rec = decide({ remainingMinutes: timeLeftMin, edgeUp: edge.edgeUp, edgeDown: edge.edgeDown, modelUp, modelDown });

      if (CONFIG.quant.safeNoTradeWithoutQuant && (!quant || !priceToBeat || !currentPrice || !sigma)) {
        rec = { ...rec, action: "NO_TRADE", side: null, phase: "SAFE", strength: "LOW" };
      }
      pLong = modelUp;
      pShort = modelDown;
      predictValue = `${ANSI.green}LONG${ANSI.reset} ${ANSI.green}${formatProbPct(pLong, 0)}${ANSI.reset} / ${ANSI.red}SHORT${ANSI.reset} ${ANSI.red}${formatProbPct(pShort, 0)}${ANSI.reset}`;
      signal = rec.action === "ENTER" ? (rec.side === "UP" ? "COMPRAR SUBE" : "COMPRAR BAJA") : "SIN OPERACIÓN";

      const polyProjection = computePolyFutureProjection({
        marketUp,
        marketDown,
        chainlinkPrice: currentPrice,
        binancePrice: spotPrice,
        priceToBeat,
        sigma,
        tSec,
        wModel: CONFIG.quant.wQuant
      });

      const triCompareLine = kv(
        "Tri-precio:",
        `Binance $${formatNumber(spotPrice, 4)} | Chainlink $${formatNumber(currentPrice, 4)} | Poly UP ${formatNumber(polyProjection?.marketUpProb !== null ? (polyProjection.marketUpProb * 100) : null, 1)}¢`
      );

      const polyFutureLine = kv(
        "Poly futuro:",
        `${formatNumber(polyProjection.futureUpCents, 1)}¢ UP | edge ${polyProjection.edgeVsMarketUpCents === null ? '-' : `${polyProjection.edgeVsMarketUpCents >= 0 ? '+' : ''}${polyProjection.edgeVsMarketUpCents.toFixed(2)}¢`} | ${polyProjection.strategy}`
      );

      const currentPriceBaseLine = colorPriceLine({
        label: "Precio actual",
        price: currentPrice,
        prevPrice: prevCurrentPrice,
        decimals: 2,
        prefix: "$"
      });

      const ptbDelta = (currentPrice !== null && priceToBeat !== null && Number.isFinite(currentPrice) && Number.isFinite(priceToBeat))
        ? currentPrice - priceToBeat
        : null;
      const ptbDeltaColor = ptbDelta === null
        ? ANSI.gray
        : ptbDelta > 0
          ? ANSI.green
          : ptbDelta < 0
            ? ANSI.red
            : ANSI.gray;
      const ptbDeltaText = ptbDelta === null
        ? `${ANSI.gray}-${ANSI.reset}`
        : `${ptbDeltaColor}${ptbDelta > 0 ? "+" : ptbDelta < 0 ? "-" : ""}$${Math.abs(ptbDelta).toFixed(2)}${ANSI.reset}`;
      const currentPriceValue = currentPriceBaseLine.split(": ")[1] ?? currentPriceBaseLine;
      const currentPriceLine = kv("Chainlink (S):", `${currentPriceValue} (${ptbDeltaText})`);

      if (poly.ok && poly.market && priceToBeatState.value === null) {
        const slug = safeFileSlug(poly.market.slug || poly.market.id || "market");
        if (slug && !dumpedMarkets.has(slug)) {
          dumpedMarkets.add(slug);
          try {
            fs.mkdirSync("./logs", { recursive: true });
            fs.writeFileSync(path.join("./logs", `polymarket_market_${slug}.json`), JSON.stringify(poly.market, null, 2), "utf8");
          } catch {
            // ignore
          }
        }
      }

      const binanceSpotBaseLine = colorPriceLine({ label: `${CONFIG.coin} (Binance)`, price: spotPrice, prevPrice: prevSpotPrice, decimals: 4, prefix: "$" });
      const diffLine = (spotPrice !== null && currentPrice !== null && Number.isFinite(spotPrice) && Number.isFinite(currentPrice) && currentPrice !== 0)
        ? (() => {
          const diffUsd = spotPrice - currentPrice;
          const diffPct = (diffUsd / currentPrice) * 100;
          const sign = diffUsd > 0 ? "+" : diffUsd < 0 ? "-" : "";
          return ` (${sign}$${Math.abs(diffUsd).toFixed(2)}, ${sign}${Math.abs(diffPct).toFixed(2)}%)`;
        })()
        : "";
      const binanceSpotLine = `${binanceSpotBaseLine}${diffLine}`;
      const binanceSpotValue = binanceSpotLine.split(": ")[1] ?? binanceSpotLine;
      const binanceVsStrike = binanceVsStrikeShort;
      const binanceSpotKvLine = kv(`${CONFIG.coin} (Binance):`, `${binanceSpotValue} | ΔK ${binanceVsStrike}`);

      const titleLine = poly.ok ? `${poly.market?.question ?? "-"}` : "-";
      const marketLine = kv("Mercado:", poly.ok ? (poly.market?.slug ?? "-") : "-");

      const compactMode = screenWidth() <= 115;
      const marketPriceLine = kv(
        "Mercado 15m:",
        `UP ${formatNumber(marketUp, 1)}¢ | DN ${formatNumber(marketDown, 1)}¢ | K ${priceToBeat !== null ? `$${formatNumber(priceToBeat, 2)}` : "-"}`
      );
      const chainlinkLine = kv(
        "Chainlink:",
        `${currentPrice !== null ? `$${formatNumber(currentPrice, 4)}` : "-"} | src ${chainlink?.source ?? "-"}`
      );
      const binanceLine = kv(
        "Binance:",
        `${spotPrice !== null ? `$${formatNumber(spotPrice, 4)}` : "-"} | ΔK ${binanceVsStrikeShort}`
      );

      const timeColor = timeLeftMin >= 10 && timeLeftMin <= 15
        ? ANSI.green
        : timeLeftMin >= 5 && timeLeftMin < 10
          ? ANSI.yellow
          : timeLeftMin >= 0 && timeLeftMin < 5
            ? ANSI.red
            : ANSI.reset;
      const polyTimeLeftColor = settlementLeftMin !== null
        ? (settlementLeftMin >= 10 && settlementLeftMin <= 15
          ? ANSI.green
          : settlementLeftMin >= 5 && settlementLeftMin < 10
            ? ANSI.yellow
            : settlementLeftMin >= 0 && settlementLeftMin < 5
              ? ANSI.red
              : ANSI.reset)
        : ANSI.reset;

      const lines = compactMode
        ? [
          kv("Coin:", `${CONFIG.coin} | ${poly.ok ? (poly.market?.slug ?? "-") : "-"}`),
          kv("Tiempo:", `${timeColor}${fmtTimeLeft(timeLeftMin)}${ANSI.reset}`),
          marketPriceLine,
          chainlinkLine,
          binanceLine,
          kv("Modelo:", `${formatProbPct(modelUp, 1)} / ${formatProbPct(modelDown, 1)} | σ ${sigma !== null ? sigma.toExponential(2) : "N/A"}`),
          kv("Poly fut:", `${formatNumber(polyProjection.futureUpCents, 1)}¢ | edge ${polyProjection.edgeVsMarketUpCents === null ? '-' : `${polyProjection.edgeVsMarketUpCents >= 0 ? '+' : ''}${polyProjection.edgeVsMarketUpCents.toFixed(2)}¢`} | ${polyProjection.strategy}`),
          kv("Rec:", `${rec.action === "ENTER" ? rec.side : "NO_TRADE"} | Edge ${formatProbPct(edge.edgeUp,1)}/${formatProbPct(edge.edgeDown,1)}`),
          kv("ET:", `${fmtEtTime(new Date())} | ${getBtcSession(new Date())}`)
        ]
        : [
          titleLine,
          marketLine,
          kv("Tiempo restante:", `${timeColor}${fmtTimeLeft(timeLeftMin)}${ANSI.reset}`),
          "",
          sepLine(),
          "",
          kv("Modelo final:", predictValue),
          kv("Modelo quant:", `${formatProbPct(quant?.pUp, 1)} / ${formatProbPct(quant?.pDown, 1)} | σ=${sigma !== null ? sigma.toExponential(3) : "N/A"}`),
          triCompareLine,
          polyFutureLine,
          kv("Heikin Ashi:", heikenLine.split(": ")[1] ?? heikenLine),
          kv("RSI:", rsiLine.split(": ")[1] ?? rsiLine),
          kv("MACD:", macdLine.split(": ")[1] ?? macdLine),
          kv("Variación 1/3:", deltaLine.split(": ")[1] ?? deltaLine),
          kv("VWAP:", vwapLine.split(": ")[1] ?? vwapLine),
          "",
          sepLine(),
          "",
          kv("POLYMARKET:", polyHeaderValue),
          liquidity !== null ? kv("Liquidez:", formatNumber(liquidity, 0)) : null,
          settlementLeftMin !== null ? kv("Tiempo restante:", `${polyTimeLeftColor}${fmtTimeLeft(settlementLeftMin)}${ANSI.reset}`) : null,
          priceToBeat !== null ? kv("Precio objetivo (K):", `$${formatNumber(priceToBeat, 4)}`) : kv("Precio objetivo (K):", `${ANSI.gray}-${ANSI.reset}`),
          currentPriceLine,
          kv("Chainlink src:", chainlink?.source ?? "-"),
          "",
          sepLine(),
          "",
          binanceSpotKvLine,
          "",
          sepLine(),
          "",
          kv("Coin | ET | Sesión:", `${ANSI.white}${CONFIG.coin}${ANSI.reset} | ${ANSI.white}${fmtEtTime(new Date())}${ANSI.reset} | ${ANSI.white}${getBtcSession(new Date())}${ANSI.reset}`),
          kv("Edge U/D:", `${formatProbPct(edge.edgeUp,1)} / ${formatProbPct(edge.edgeDown,1)} | Rec: ${rec.action === "ENTER" ? rec.side : "NO_TRADE"}`),
          "",
          sepLine(),
          centerText(`${ANSI.dim}${ANSI.gray}hecho por @krajekis${ANSI.reset}`, screenWidth())
        ];

      renderScreen(lines.join("\n") + "\n");

      prevSpotPrice = spotPrice ?? prevSpotPrice;
      prevCurrentPrice = currentPrice ?? prevCurrentPrice;

      netErrorStreak = 0;
      appendCsvRow("./logs/signals.csv", header, [
        new Date().toISOString(),
        timing.elapsedMinutes.toFixed(3),
        timeLeftMin.toFixed(3),
        regimeInfo.regime,
        signal,
        modelUp,
        modelDown,
        marketUp,
        marketDown,
        edge.edgeUp,
        edge.edgeDown,
        rec.action === "ENTER" ? `${rec.side}:${rec.phase}:${rec.strength}` : "NO_TRADE",
        polyProjection.futureUpCents,
        polyProjection.edgeVsMarketUpCents,
        polyProjection.strategy
      ]);
    } catch (err) {
      const causeCode = err?.cause?.code ? ` [${err.cause.code}]` : "";
      const causeMsg = err?.cause?.message ? ` | causa: ${err.cause.message}` : "";
      const errMsg = String(err?.message ?? String(err));
      const sig = `${causeCode}:${causeMsg}:${errMsg}`;
      const now = Date.now();

      if (sig === lastErrorSig) {
        netErrorStreak += 1;
      } else {
        netErrorStreak = 1;
        lastErrorSig = sig;
      }

      const shouldLog = netErrorStreak === 1 || (now - lastErrorLogAt >= 5000);
      if (shouldLog) {
        lastErrorLogAt = now;
        console.log("────────────────────────────");
        console.log(`Error de red/datos${causeCode}: ${errMsg}${causeMsg}`);
        if (netErrorStreak > 1) {
          console.log(`Reintentos consecutivos: ${netErrorStreak}`);
        }
        console.log("Sugerencia: revisa conectividad/proxy del contenedor o aumenta timeout de smoke test.");
        console.log("────────────────────────────");
      }
    }

    const elapsedMs = Date.now() - loopStartMs;
    const baseWaitMs = Math.max(100, CONFIG.pollIntervalMs - elapsedMs);
    const backoffMs = netErrorStreak > 0 ? Math.min(4_000, 500 * netErrorStreak) : 0;
    const waitMs = Math.max(baseWaitMs, backoffMs);
    await sleep(waitMs);
  }
}

main();

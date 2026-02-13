function isNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function phaseFromTsec(tSec) {
  if (tSec > 600) return "EARLY";
  if (tSec > 180) return "MID";
  if (tSec > 30) return "LATE";
  return "ULTRALATE";
}

function scalpThresholdByPhase(phase) {
  if (phase === "EARLY") return 0.02;
  if (phase === "MID") return 0.015;
  return 0.01;
}

export function createStrategyEngine() {
  const states = new Map();

  function getState(marketSlug) {
    if (!states.has(marketSlug)) {
      states.set(marketSlug, {
        didScalp: false,
        didHold: false,
        scalpClosed: false,
        scalpPos: null,
        holdPos: null,
        pendingAggressive: null
      });
    }
    return states.get(marketSlug);
  }

  function decide(input) {
    const {
      marketSlug,
      tSec,
      sigma,
      spread,
      liquidity,
      edgeUp,
      edgeDown,
      pModelUp,
      pModelDown,
      marketUpPrice,
      marketDownPrice,
      chainlinkPrice,
      binancePrice,
      strike
    } = input;

    if (!marketSlug) return { actions: [], phase: "UNKNOWN", note: "missing_market" };
    const st = getState(marketSlug);

    const t = isNum(tSec);
    const sig = isNum(sigma);
    const spr = isNum(spread);
    const liq = isNum(liquidity);
    const eUp = isNum(edgeUp);
    const eDown = isNum(edgeDown);
    const pUp = isNum(pModelUp);
    const pDown = isNum(pModelDown);
    const mUp = isNum(marketUpPrice);
    const mDown = isNum(marketDownPrice);
    const s = isNum(chainlinkPrice);
    const b = isNum(binancePrice);
    const k = isNum(strike);

    if (t === null || t <= 0) return { actions: [], phase: "CLOSED", note: "market_ended" };

    const phase = phaseFromTsec(t);
    const actions = [];

    const hasValidSigma = sig !== null && sig > 0;
    const spreadOk = spr !== null && spr <= 0.03;
    const scalpSpreadOk = spr !== null && spr <= 0.025;
    const liquidityOk = liq !== null && liq >= 5;

    // 0) Exit scalp if open
    if (st.scalpPos) {
      const cur = st.scalpPos.side === "UP" ? mUp : mDown;
      const ageSec = (Date.now() - st.scalpPos.openedAtMs) / 1000;
      if (cur !== null) {
        const pnl = cur - st.scalpPos.entryPrice;
        if (pnl >= 0.02) {
          actions.push({ type: "CLOSE", tag: "SCALP", side: st.scalpPos.side, sizeUsd: 1, reason: "TP_+0.02" });
          st.scalpPos = null;
          st.scalpClosed = true;
        } else if (pnl <= -0.02) {
          actions.push({ type: "CLOSE", tag: "SCALP", side: st.scalpPos.side, sizeUsd: 1, reason: "SL_-0.02" });
          st.scalpPos = null;
          st.scalpClosed = true;
        } else if (ageSec > 120) {
          actions.push({ type: "CLOSE", tag: "SCALP", side: st.scalpPos.side, sizeUsd: 1, reason: "TIMEOUT_120s" });
          st.scalpPos = null;
          st.scalpClosed = true;
        }
      }
    }

    const exposureUsd = (st.scalpPos ? 1 : 0) + (st.holdPos ? 1 : 0);

    // 1) Binance adelantado (arming)
    if (!st.didScalp && !st.scalpPos && !st.scalpClosed && s !== null && b !== null && k !== null && spreadOk && liquidityOk && hasValidSigma) {
      const bCrossUp = b >= k && s < k;
      const bCrossDown = b < k && s >= k;
      const sigMove = Math.abs((b - k) / k) > 0.001;
      if (sigMove && (bCrossUp || bCrossDown)) {
        st.pendingAggressive = {
          side: bCrossUp ? "UP" : "DOWN",
          atMs: Date.now()
        };
      }

      if (st.pendingAggressive && Date.now() - st.pendingAggressive.atMs <= 20_000) {
        const side = st.pendingAggressive.side;
        const confirmed = (side === "UP" && s >= k) || (side === "DOWN" && s < k);
        if (confirmed && t > 90 && scalpSpreadOk && exposureUsd < 2) {
          actions.push({ type: "OPEN", tag: "SCALP", side, sizeUsd: 1, reason: "BINANCE_LEAD_CONFIRM" });
          st.didScalp = true;
          st.scalpPos = {
            side,
            entryPrice: side === "UP" ? (mUp ?? 0) : (mDown ?? 0),
            openedAtMs: Date.now()
          };
          st.pendingAggressive = null;
        }
      }
    }

    // 2) Scalping controlado
    if (!st.didScalp && !st.scalpPos && !st.scalpClosed && t > 90 && scalpSpreadOk && liquidityOk && hasValidSigma && exposureUsd < 2) {
      const th = scalpThresholdByPhase(phase);
      if (eUp !== null && eUp >= th) {
        actions.push({ type: "OPEN", tag: "SCALP", side: "UP", sizeUsd: 1, reason: `EDGE_UP_${th}` });
        st.didScalp = true;
        st.scalpPos = { side: "UP", entryPrice: mUp ?? 0, openedAtMs: Date.now() };
      } else if (eDown !== null && eDown >= th) {
        actions.push({ type: "OPEN", tag: "SCALP", side: "DOWN", sizeUsd: 1, reason: `EDGE_DOWN_${th}` });
        st.didScalp = true;
        st.scalpPos = { side: "DOWN", entryPrice: mDown ?? 0, openedAtMs: Date.now() };
      }
    }

    // 3) Regla forzada scalping a 150s (primera oportunidad <=150)
    if (!st.didScalp && !st.scalpPos && !st.scalpClosed && t <= 150 && t > 90 && spreadOk && liquidityOk && hasValidSigma && exposureUsd < 2) {
      if ((eUp ?? -Infinity) >= (eDown ?? -Infinity)) {
        actions.push({ type: "OPEN", tag: "SCALP", side: "UP", sizeUsd: 1, reason: "FORCED_SCALP_150" });
        st.didScalp = true;
        st.scalpPos = { side: "UP", entryPrice: mUp ?? 0, openedAtMs: Date.now() };
      } else {
        actions.push({ type: "OPEN", tag: "SCALP", side: "DOWN", sizeUsd: 1, reason: "FORCED_SCALP_150" });
        st.didScalp = true;
        st.scalpPos = { side: "DOWN", entryPrice: mDown ?? 0, openedAtMs: Date.now() };
      }
    }

    // 4) Hold final <=60
    if (!st.didHold && !st.holdPos && t <= 60 && spreadOk && liquidityOk && hasValidSigma && exposureUsd < 2 && s !== null && k !== null) {
      const volWindow = sig * Math.sqrt(t);
      const distance = s - k;
      const absDistance = Math.abs(distance);
      const dominant = distance >= 0 ? "UP" : "DOWN";
      const dominantProb = dominant === "UP" ? pUp : pDown;

      if (absDistance > 3 * volWindow && (dominantProb ?? 0) >= 0.97) {
        actions.push({ type: "OPEN", tag: "HOLD", side: dominant, sizeUsd: 1, reason: "HOLD_DOM_0.97" });
        st.didHold = true;
        st.holdPos = { side: dominant, entryPrice: dominant === "UP" ? (mUp ?? 0) : (mDown ?? 0), openedAtMs: Date.now() };
      } else {
        if ((pUp ?? 0) >= 0.55) {
          actions.push({ type: "OPEN", tag: "HOLD", side: "UP", sizeUsd: 1, reason: "HOLD_PUP_0.55" });
          st.didHold = true;
          st.holdPos = { side: "UP", entryPrice: mUp ?? 0, openedAtMs: Date.now() };
        } else if ((pDown ?? 0) >= 0.55) {
          actions.push({ type: "OPEN", tag: "HOLD", side: "DOWN", sizeUsd: 1, reason: "HOLD_PDOWN_0.55" });
          st.didHold = true;
          st.holdPos = { side: "DOWN", entryPrice: mDown ?? 0, openedAtMs: Date.now() };
        }
      }
    }

    // 5) Regla forzada hold a 45s
    if (!st.didHold && !st.holdPos && t <= 45 && spreadOk && liquidityOk && hasValidSigma && exposureUsd < 2) {
      if ((pUp ?? -Infinity) >= (pDown ?? -Infinity)) {
        actions.push({ type: "OPEN", tag: "HOLD", side: "UP", sizeUsd: 1, reason: "FORCED_HOLD_45" });
        st.didHold = true;
        st.holdPos = { side: "UP", entryPrice: mUp ?? 0, openedAtMs: Date.now() };
      } else {
        actions.push({ type: "OPEN", tag: "HOLD", side: "DOWN", sizeUsd: 1, reason: "FORCED_HOLD_45" });
        st.didHold = true;
        st.holdPos = { side: "DOWN", entryPrice: mDown ?? 0, openedAtMs: Date.now() };
      }
    }

    return {
      phase,
      note: hasValidSigma && spreadOk && liquidityOk ? "OK" : "RISK_FILTER",
      actions
    };
  }

  return {
    decide
  };
}

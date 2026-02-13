function isFiniteNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function erfApprox(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

export function estimateSigmaFromBinanceCloses(closes, lookbackMinutes = 120, minSamples = 30) {
  const arr = Array.isArray(closes) ? closes.map((x) => isFiniteNumber(x)).filter((x) => x !== null) : [];
  if (arr.length < 3) return null;

  const requiredSamples = Math.max(2, Number(minSamples) || 30);

  const window = arr.slice(-Math.max(3, Number(lookbackMinutes)));
  const rets = [];
  for (let i = 1; i < window.length; i += 1) {
    const prev = window[i - 1];
    const cur = window[i];
    if (prev <= 0 || cur <= 0) continue;
    const r = Math.log(cur / prev);
    if (Number.isFinite(r)) rets.push(r);
  }

  if (rets.length < requiredSamples) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const var1m = rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1);
  if (!Number.isFinite(var1m) || var1m <= 0) return null;

  const varSec = var1m / 60;
  const sigma = Math.sqrt(varSec);
  return Number.isFinite(sigma) ? sigma : null;
}

export function probUpLognormal(S, K, Tsec, sigma) {
  const s = isFiniteNumber(S);
  const k = isFiniteNumber(K);
  const t = isFiniteNumber(Tsec);
  const sig = isFiniteNumber(sigma);

  if (s === null || k === null || t === null || sig === null) return null;
  if (s <= 0 || k <= 0 || t <= 0 || sig <= 0) return null;

  const denom = sig * Math.sqrt(t);
  if (!Number.isFinite(denom) || denom <= 0) return null;

  const z = Math.log(k / s) / denom;
  const pUpRaw = 1 - normalCdf(z);
  const pUp = Math.max(0.001, Math.min(0.999, pUpRaw));
  const pDown = 1 - pUp;

  return { pUp, pDown, z };
}

export function blendProbabilities(pQuantUp, pHeurUp, wQuant = 0.7) {
  const pq = isFiniteNumber(pQuantUp);
  const ph = isFiniteNumber(pHeurUp);
  const w = Math.max(0, Math.min(1, isFiniteNumber(wQuant) ?? 0.7));

  if (pq === null && ph === null) return null;
  if (pq === null) return { pUp: ph, pDown: 1 - ph, mode: "heur_only" };
  if (ph === null) return { pUp: pq, pDown: 1 - pq, mode: "quant_only" };

  const pUp = (w * pq) + ((1 - w) * ph);
  const pClamped = Math.max(0.001, Math.min(0.999, pUp));
  return { pUp: pClamped, pDown: 1 - pClamped, mode: "blend" };
}

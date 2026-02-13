const COIN_MAP = {
  BTC: {
    symbol: "BTCUSDT",
    slugPrefix: "btc-updown-15m-",
    seriesSlug: "btc-up-or-down-15m",
    chainlinkAggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
    chainlinkDecimals: 8,
    polySymbolIncludes: "btc"
  },
  ETH: {
    symbol: "ETHUSDT",
    slugPrefix: "eth-updown-15m-",
    seriesSlug: "eth-up-or-down-15m",
    chainlinkAggregator: "0xF9680D99D6C9589e2a93a78A04A279e509205945",
    chainlinkDecimals: 8,
    polySymbolIncludes: "eth"
  },
  SOL: {
    symbol: "SOLUSDT",
    slugPrefix: "sol-updown-15m-",
    seriesSlug: "sol-up-or-down-15m",
    chainlinkAggregator: "0x10C8264C0935b3B9870013e057f330Ff3e9C56dC",
    chainlinkDecimals: 8,
    polySymbolIncludes: "sol"
  },
  XRP: {
    symbol: "XRPUSDT",
    slugPrefix: "xrp-updown-15m-",
    seriesSlug: "xrp-up-or-down-15m",
    chainlinkAggregator: "0x785ba89291f676b5386652eB12b30cF361020694",
    chainlinkDecimals: 8,
    polySymbolIncludes: "xrp"
  }
};

const coin = String(process.env.COIN || "BTC").trim().toUpperCase();
const coinProfile = COIN_MAP[coin] ?? COIN_MAP.BTC;

export const CONFIG = {
  coin,
  coinProfile,
  symbol: coinProfile.symbol,
  binanceBaseUrl: "https://api.binance.com",
  gammaBaseUrl: "https://gamma-api.polymarket.com",
  clobBaseUrl: "https://clob.polymarket.com",

  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 700),
  candleWindowMinutes: 15,

  vwapSlopeLookbackMinutes: 5,
  rsiPeriod: 14,
  rsiMaPeriod: 14,

  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,

  quant: {
    sigmaLookbackMinutes: Number(process.env.QUANT_SIGMA_LOOKBACK_MIN || 120),
    minSamples: Number(process.env.QUANT_MIN_SAMPLES || 30),
    wQuant: Number(process.env.QUANT_WEIGHT || 0.7),
    sigmaMin: Number(process.env.QUANT_SIGMA_MIN || 0),
    safeNoTradeWithoutQuant: (process.env.SAFE_NO_TRADE_WITHOUT_QUANT || "true").toLowerCase() === "true"
  },

  polymarket: {
    marketSlug: process.env.POLYMARKET_SLUG || "",
    seriesSlug: process.env.POLYMARKET_SERIES_SLUG || coinProfile.seriesSlug,
    slugPrefix: process.env.POLYMARKET_SLUG_PREFIX || coinProfile.slugPrefix,
    autoSelectLatest: (process.env.POLYMARKET_AUTO_SELECT_LATEST || "true").toLowerCase() === "true",
    liveDataWsUrl: process.env.POLYMARKET_LIVE_WS_URL || "wss://ws-live-data.polymarket.com",
    livePriceSymbolIncludes: process.env.POLYMARKET_WS_SYMBOL_INCLUDES || coinProfile.polySymbolIncludes,
    upOutcomeLabel: process.env.POLYMARKET_UP_LABEL || "Up",
    downOutcomeLabel: process.env.POLYMARKET_DOWN_LABEL || "Down"
  },

  chainlink: {
    polygonRpcUrls: (process.env.POLYGON_RPC_URLS || "").split(",").map((s) => s.trim()).filter(Boolean),
    polygonRpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    polygonWssUrls: (process.env.POLYGON_WSS_URLS || "").split(",").map((s) => s.trim()).filter(Boolean),
    polygonWssUrl: process.env.POLYGON_WSS_URL || "",
    usdAggregator: process.env.CHAINLINK_USD_AGGREGATOR || coinProfile.chainlinkAggregator,
    decimals: Number(process.env.CHAINLINK_DECIMALS || coinProfile.chainlinkDecimals)
  },

  trading: {
    enabled: (process.env.POLY_TRADING_ENABLED || "false").toLowerCase() === "true",
    dryRun: (process.env.POLY_TRADING_DRY_RUN || "true").toLowerCase() === "true",
    apiUrl: process.env.POLY_TRADING_API_URL || "https://clob.polymarket.com",
    apiKey: process.env.POLYMARKET_API_KEY || "",
    apiSecret: process.env.POLYMARKET_API_SECRET || "",
    apiPassphrase: process.env.POLYMARKET_API_PASSPHRASE || "",
    defaultOrderSizeUsd: Number(process.env.POLY_TRADING_ORDER_SIZE_USD || 15),
    minEdgeCents: Number(process.env.POLY_TRADING_MIN_EDGE_CENTS || 1.5),
    cooldownMs: Number(process.env.POLY_TRADING_COOLDOWN_MS || 90_000)
  },

};

export { COIN_MAP };

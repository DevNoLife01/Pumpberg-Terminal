// Shared TypeScript types mirroring the FastAPI response shapes

export interface Indicators {
  ema20:       number | null;
  ema50:       number | null;
  rsi:         number | null;
  macd:        number | null;
  macd_signal: number | null;
  macd_hist:   number | null;
  bb_upper:    number | null;
  bb_mid:      number | null;
  bb_lower:    number | null;
}

export interface IndicatorSeries {
  ema20:       (number | null)[];
  ema50:       (number | null)[];
  rsi:         (number | null)[];
  macd:        (number | null)[];
  macd_signal: (number | null)[];
  macd_hist:   (number | null)[];
  bb_upper:    (number | null)[];
  bb_mid:      (number | null)[];
  bb_lower:    (number | null)[];
}

export interface Candle {
  t: number; // unix timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface RawTrade {
  ts:    number;
  price: number;
  size:  number;
  side:  "buy" | "sell";
}

export interface TokenSnapshot {
  symbol:      string;
  mint:        string;
  price:       number | null;
  change_pct:  number;
  volume_24h:  number;
  trade_count: number;
  discovered:  number;
  signal:      string;
  risk:        string[];
  indicators:  Indicators;
  // Only present in full token fetch
  candles?:          Record<string, Candle[]>;
  prices?:           number[];
  indicator_series?: IndicatorSeries;
  recent_trades?:    RawTrade[];
  // Extra fields from DexScreener
  liquidity?: number;
  source?: "pump" | "dex";
}

export interface TokenListResponse {
  tokens: TokenSnapshot[];
  total:  number;
}

export type ChartType = "candle" | "line" | "quant" | "depth";
export type Timeframe = "1s" | "5s" | "1m" | "5m" | "15m";

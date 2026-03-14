"use client";
import {
  ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import type { Candle, TokenSnapshot, Timeframe } from "@/lib/types";
import { fmt, fmtTime } from "@/lib/utils";

// ── Bloomberg-style tooltip ───────────────────────────────────────────────
const ttStyle = {
  background: "#0a0a0a",
  border: "1px solid #333",
  borderRadius: 0,
  fontSize: 10,
  fontFamily: "inherit",
  color: "#ff9500",
  padding: "4px 8px",
};

// ── CANDLE chart ──────────────────────────────────────────────────────────
interface CandleBarProps {
  x?: number; y?: number; width?: number; height?: number;
  payload?: Candle & { bodyY: number; bodyH: number; isUp: boolean };
}

function CandleBar(props: CandleBarProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const { bodyY, bodyH, isUp } = payload;
  const fill   = isUp ? "#00c853" : "#ff1744";
  const stroke = isUp ? "#00c853" : "#ff1744";
  const cx     = x + width / 2;

  return (
    <g>
      <line x1={cx} y1={y} x2={cx} y2={y + (bodyY ?? 0)} stroke={stroke} strokeWidth={1} />
      <rect
        x={x + 1}
        y={y + (bodyY ?? 0)}
        width={width - 2}
        height={Math.max(1, bodyH ?? 0)}
        fill={fill}
      />
      <line
        x1={cx}
        y1={y + (bodyY ?? 0) + Math.max(1, bodyH ?? 0)}
        x2={cx}
        y2={y + height}
        stroke={stroke}
        strokeWidth={1}
      />
    </g>
  );
}

function prepareCandleData(candles: Candle[]) {
  if (!candles.length) return [];
  const allH = candles.map((c) => c.h);
  const allL = candles.map((c) => c.l);
  const rangeMax = Math.max(...allH);
  const rangeMin = Math.min(...allL);
  const range = rangeMax - rangeMin || 1;

  return candles.map((c) => {
    const isUp  = c.c >= c.o;
    const bodyTop    = Math.max(c.o, c.c);
    const bodyBottom = Math.min(c.o, c.c);
    const bodyY = (rangeMax - bodyTop) / range;
    const bodyH = (bodyTop - bodyBottom) / range;
    return { ...c, isUp, bodyY, bodyH, range: c.h - c.l, base: c.l };
  });
}

export function CandleChart({ candles, tf }: { candles: Candle[]; tf: Timeframe }) {
  const data = prepareCandleData(candles.slice(-120));
  if (!data.length) return <EmptyChart label="WAITING FOR DATA" />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="t" tickFormatter={(v) => fmtTime(v)}
          tick={{ fill: "#666", fontSize: 9 }} axisLine={{ stroke: "#333" }} tickLine={false}
          minTickGap={60}
        />
        <YAxis
          domain={["auto", "auto"]}
          tick={{ fill: "#666", fontSize: 9 }} axisLine={{ stroke: "#333" }} tickLine={false}
          tickFormatter={(v) => fmt(v, 4)} width={60}
        />
        <Tooltip
          contentStyle={ttStyle}
          labelFormatter={(v) => fmtTime(Number(v))}
          formatter={(v: number, name: string) => [fmt(v), name]}
        />
        <Bar dataKey="range" stackId="c" fill="transparent" isAnimationActive={false}
          shape={(props: CandleBarProps) => <CandleBar {...props} />}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── LINE chart ─────────────────────────────────────────────────────────────
export function LineChart({ prices, indicators }: {
  prices: number[];
  indicators?: { ema20: (number|null)[]; ema50: (number|null)[] };
}) {
  const pts = prices.slice(-300);
  if (!pts.length) return <EmptyChart label="WAITING FOR DATA" />;

  const data = pts.map((p, i) => ({
    i,
    price: p,
    ema20: indicators?.ema20?.[i] ?? null,
    ema50: indicators?.ema50?.[i] ?? null,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
        <defs>
          <linearGradient id="priceGradBloom" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#00c853" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#00c853" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis domain={["auto", "auto"]}
          tick={{ fill: "#666", fontSize: 9 }} axisLine={{ stroke: "#333" }} tickLine={false}
          tickFormatter={(v) => fmt(v)} width={60}
        />
        <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} labelFormatter={() => ""} />
        <Area dataKey="price" stroke="#00c853" fill="url(#priceGradBloom)"
          strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line dataKey="ema20" stroke="#ff9500" strokeWidth={1} dot={false}
          isAnimationActive={false} />
        <Line dataKey="ema50" stroke="#2196f3" strokeWidth={1} dot={false}
          isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── QUANT chart (RSI + MACD + Bollinger) ──────────────────────────────────
export function QuantChart({ data }: { data: TokenSnapshot }) {
  const ser = data.indicator_series;
  const prices = data.prices ?? [];
  if (!ser || !prices.length) return <EmptyChart label="CALCULATING..." />;

  const n = Math.min(prices.length, 300);
  const pts = Array.from({ length: n }, (_, i) => ({
    i,
    price:    prices[prices.length - n + i],
    bb_upper: ser.bb_upper[ser.bb_upper.length - n + i] ?? null,
    bb_mid:   ser.bb_mid[ser.bb_mid.length - n + i]     ?? null,
    bb_lower: ser.bb_lower[ser.bb_lower.length - n + i] ?? null,
    rsi:      ser.rsi[ser.rsi.length - n + i]            ?? null,
    macd:     ser.macd[ser.macd.length - n + i]          ?? null,
    macd_sig: ser.macd_signal[ser.macd_signal.length - n + i] ?? null,
    macd_h:   ser.macd_hist[ser.macd_hist.length - n + i]     ?? null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Bollinger + Price */}
      <div style={{ flex: 2, borderBottom: "1px solid #333" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pts} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="bbGradBloom" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00c853" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#00c853" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" hide />
            <YAxis domain={["auto", "auto"]}
              tick={{ fill: "#666", fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => fmt(v)} width={56}
            />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} labelFormatter={() => ""} />
            <Area dataKey="price" stroke="#00c853" fill="url(#bbGradBloom)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="bb_upper" stroke="#666" strokeWidth={1} dot={false} isAnimationActive={false} strokeDasharray="2 2" />
            <Line dataKey="bb_mid"   stroke="#444" strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line dataKey="bb_lower" stroke="#666" strokeWidth={1} dot={false} isAnimationActive={false} strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* RSI */}
      <div style={{ flex: 1, borderBottom: "1px solid #333" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pts} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rsiGradBloom" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ff9500" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ff9500" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" hide />
            <YAxis domain={[0, 100]}
              tick={{ fill: "#666", fontSize: 9 }} axisLine={false} tickLine={false}
              ticks={[30, 70]} width={24}
            />
            <ReferenceLine y={70} stroke="#ff1744" strokeDasharray="2 2" />
            <ReferenceLine y={30} stroke="#00c853" strokeDasharray="2 2" />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [v?.toFixed(1), "RSI"]} labelFormatter={() => ""} />
            <Area dataKey="rsi" stroke="#ff9500" fill="url(#rsiGradBloom)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* MACD */}
      <div style={{ flex: 1 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pts} margin={{ top: 2, right: 4, left: 0, bottom: 2 }}>
            <XAxis dataKey="i" hide />
            <YAxis domain={["auto", "auto"]}
              tick={{ fill: "#666", fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => v?.toFixed(5)} width={48}
            />
            <ReferenceLine y={0} stroke="#333" />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} labelFormatter={() => ""} />
            <Bar dataKey="macd_h" isAnimationActive={false} maxBarSize={3}>
              {pts.map((p, i) => (
                <Cell key={i} fill={(p.macd_h ?? 0) >= 0 ? "#00c853" : "#ff1744"} />
              ))}
            </Bar>
            <Line dataKey="macd"     stroke="#2196f3" strokeWidth={1} dot={false} isAnimationActive={false} />
            <Line dataKey="macd_sig" stroke="#ff9500" strokeWidth={1} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── DEPTH chart ────────────────────────────────────────────────────────────
export function DepthChart({ token }: { token: TokenSnapshot }) {
  const trades = token.recent_trades ?? [];
  if (!trades.length || !token.price) return <EmptyChart label="WAITING FOR DATA" />;

  const price  = token.price;
  const spread = price * 0.005;

  const levels = 20;
  const bidData = Array.from({ length: levels }, (_, i) => {
    const p   = price - spread * (i + 1);
    const qty = Math.random() * 10000 + 500;
    return { price: p, qty, cumQty: 0, side: "bid" };
  });
  const askData = Array.from({ length: levels }, (_, i) => {
    const p   = price + spread * (i + 1);
    const qty = Math.random() * 10000 + 500;
    return { price: p, qty, cumQty: 0, side: "ask" };
  });

  let cumBid = 0, cumAsk = 0;
  for (let i = 0; i < levels; i++) {
    cumBid += bidData[levels - 1 - i].qty;
    bidData[levels - 1 - i].cumQty = cumBid;
    cumAsk += askData[i].qty;
    askData[i].cumQty = cumAsk;
  }

  const combined = [
    ...bidData.reverse().map((d) => ({ ...d, bidCum: d.cumQty, askCum: null })),
    ...askData.map((d) => ({ ...d, bidCum: null, askCum: d.cumQty })),
  ];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={combined} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
        <XAxis dataKey="price" tickFormatter={(v) => fmt(v, 4)}
          tick={{ fill: "#666", fontSize: 9 }} axisLine={{ stroke: "#333" }} tickLine={false}
          minTickGap={50}
        />
        <YAxis tick={{ fill: "#666", fontSize: 9 }} axisLine={{ stroke: "#333" }} tickLine={false}
          tickFormatter={(v) => (v / 1000).toFixed(0) + "K"} width={36}
        />
        <Tooltip contentStyle={ttStyle}
          formatter={(v: number, name: string) => [v?.toFixed(0), name === "bidCum" ? "BID" : "ASK"]}
          labelFormatter={(v) => `@ ${fmt(Number(v))}`}
        />
        <Area dataKey="bidCum" stroke="#00c853" fill="rgba(0,200,83,0.2)" strokeWidth={1.5}
          dot={false} isAnimationActive={false} connectNulls={false}
        />
        <Area dataKey="askCum" stroke="#ff1744" fill="rgba(255,23,68,0.2)" strokeWidth={1.5}
          dot={false} isAnimationActive={false} connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Volume Chart ───────────────────────────────────────────────────────────
export function VolumeChart({ candles }: { candles: Candle[] }) {
  const data = candles.slice(-60).map((c) => ({
    t: c.t,
    v: c.v,
    isUp: c.c >= c.o,
  }));
  if (!data.length) return <EmptyChart label="NO VOLUME DATA" />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
        <XAxis dataKey="t" tickFormatter={(v) => fmtTime(v)}
          tick={{ fill: "#666", fontSize: 9 }} axisLine={{ stroke: "#333" }} tickLine={false}
          minTickGap={60}
        />
        <YAxis tick={{ fill: "#666", fontSize: 9 }} axisLine={{ stroke: "#333" }} tickLine={false}
          tickFormatter={(v) => (v / 1000).toFixed(0) + "K"} width={40}
        />
        <Tooltip contentStyle={ttStyle}
          labelFormatter={(v) => fmtTime(Number(v))}
          formatter={(v: number) => [(v / 1000).toFixed(1) + "K", "VOL"]}
        />
        <Bar dataKey="v" isAnimationActive={false} maxBarSize={8}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.isUp ? "#00c853" : "#ff1744"} fillOpacity={0.7} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────
function EmptyChart({ label }: { label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", color: "#666", fontSize: 10,
      letterSpacing: "0.08em",
    }}>
      <span style={{ color: "#ff9500", marginRight: 6 }}>_</span>
      {label}
    </div>
  );
}

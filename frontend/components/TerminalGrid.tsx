"use client";
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChartType, Timeframe } from "@/lib/types";
import { useToken } from "@/lib/api";
import { fmt, fmtPct } from "@/lib/utils";
import { CandleChart, LineChart, QuantChart, DepthChart } from "./Charts";

const CHART_TYPES: { type: ChartType; label: string; color: string }[] = [
  { type: "candle", label: "OHLC", color: "#ff8c00" },
  { type: "line", label: "LINE", color: "#00ccff" },
  { type: "quant", label: "QUANT", color: "#ffff00" },
  { type: "depth", label: "DEPTH", color: "#cc66ff" },
];

const TIMEFRAMES: Timeframe[] = ["1s", "5s", "1m", "5m", "15m"];

interface TerminalProps {
  defaultType: ChartType;
  symbol: string | null;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}

function Terminal({ defaultType, symbol, isExpanded, onExpand, onCollapse }: TerminalProps) {
  const [chartType, setChartType] = useState<ChartType>(defaultType);
  const [tf, setTf] = useState<Timeframe>("1m");
  const { data: token } = useToken(symbol, isExpanded ? 500 : 1000);
  
  const cfg = CHART_TYPES.find((c) => c.type === chartType) ?? CHART_TYPES[0];
  const candles = token?.candles?.[tf] ?? [];
  const prices = token?.prices ?? [];
  const latestPrice = token?.price;
  const changePct = token?.change_pct ?? 0;
  const isUp = changePct >= 0;

  function renderChart() {
    if (!token) return <Waiting />;
    switch (chartType) {
      case "candle": return <CandleChart candles={candles} tf={tf} />;
      case "line": return <LineChart prices={prices} indicators={token.indicator_series} />;
      case "quant": return <QuantChart data={token} />;
      case "depth": return <DepthChart token={token} />;
    }
  }

  return (
    <div className="bb-panel" style={{ height: "100%", borderColor: cfg.color }}>
      {/* Header */}
      <div
        onDoubleClick={isExpanded ? onCollapse : onExpand}
        style={{
          height: 18, background: cfg.color, color: "#000",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 4px", fontWeight: "bold", fontSize: 10, cursor: "pointer",
        }}
        title="Double-click to expand/collapse"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>{cfg.label}</span>
          {symbol && (
            <>
              <span style={{ fontWeight: "normal" }}>|</span>
              <span>{symbol}</span>
              {latestPrice != null && (
                <>
                  <span style={{ fontWeight: "normal" }}>{fmt(latestPrice)}</span>
                  <span style={{ color: isUp ? "#006600" : "#660000" }}>{fmtPct(changePct)}</span>
                </>
              )}
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {/* Chart type buttons */}
          {CHART_TYPES.map(({ type, label }) => (
            <button key={type} onClick={(e) => { e.stopPropagation(); setChartType(type); }}
              style={{
                fontSize: 8, padding: "1px 4px", cursor: "pointer",
                background: chartType === type ? "#000" : "transparent",
                color: chartType === type ? cfg.color : "#000",
                border: "1px solid #000", fontWeight: chartType === type ? "bold" : "normal",
              }}
            >
              {label}
            </button>
          ))}
          <span style={{ margin: "0 2px" }}>|</span>
          {/* Timeframe buttons */}
          {chartType === "candle" && TIMEFRAMES.map((t) => (
            <button key={t} onClick={(e) => { e.stopPropagation(); setTf(t); }}
              style={{
                fontSize: 8, padding: "1px 3px", cursor: "pointer",
                background: tf === t ? "#000" : "transparent",
                color: tf === t ? cfg.color : "#000",
                border: "1px solid #000",
              }}
            >
              {t}
            </button>
          ))}
          <button onClick={(e) => { e.stopPropagation(); isExpanded ? onCollapse() : onExpand(); }}
            style={{
              fontSize: 10, padding: "0 4px", cursor: "pointer",
              background: "transparent", color: "#000", border: "1px solid #000",
              marginLeft: 4,
            }}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "−" : "+"}
          </button>
        </div>
      </div>
      {/* Chart body */}
      <div style={{ flex: 1, overflow: "hidden", background: "#000" }}>
        {renderChart()}
      </div>
    </div>
  );
}

function Waiting() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", color: "#666", fontSize: 10,
    }}>
      <span className="blink" style={{ color: "#0ff", marginRight: 4 }}>_</span>
      SELECT TOKEN
    </div>
  );
}

interface TerminalGridProps {
  symbol: string | null;
}

export default function TerminalGrid({ symbol }: TerminalGridProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const expand = useCallback((i: number) => setExpandedIdx(i), []);
  const collapse = useCallback(() => setExpandedIdx(null), []);

  const terminals: { type: ChartType }[] = [
    { type: "candle" },
    { type: "line" },
    { type: "quant" },
    { type: "depth" },
  ];

  // Expanded view
  if (expandedIdx !== null) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`expanded-${expandedIdx}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{ width: "100%", height: "100%" }}
        >
          <Terminal
            defaultType={terminals[expandedIdx].type}
            symbol={symbol}
            isExpanded={true}
            onExpand={() => {}}
            onCollapse={collapse}
          />
        </motion.div>
      </AnimatePresence>
    );
  }

  // 2x2 grid
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gridTemplateRows: "1fr 1fr",
      gap: 1,
      width: "100%",
      height: "100%",
      background: "#222",
    }}>
      {terminals.map((t, i) => (
        <Terminal
          key={i}
          defaultType={t.type}
          symbol={symbol}
          isExpanded={false}
          onExpand={() => expand(i)}
          onCollapse={collapse}
        />
      ))}
    </div>
  );
}

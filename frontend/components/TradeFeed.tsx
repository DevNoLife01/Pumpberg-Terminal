"use client";
import { useState } from "react";
import { useMarketWS } from "@/lib/api";
import { fmt, fmtTime } from "@/lib/utils";

interface TradeTick {
  id:     number;
  symbol: string;
  price:  number;
  ts:     number;
  dir:    "up" | "down" | "flat";
}

let _id = 0;
let _lastPrices: Record<string, number> = {};

export default function TradeFeed({ filter }: { filter: string | null }) {
  const [ticks, setTicks] = useState<TradeTick[]>([]);

  useMarketWS((data) => {
    if (filter && data.symbol !== filter) return;
    
    const lastPrice = _lastPrices[data.symbol] ?? data.price;
    const dir = data.price > lastPrice ? "up" : data.price < lastPrice ? "down" : "flat";
    _lastPrices[data.symbol] = data.price;

    const tick: TradeTick = { id: _id++, symbol: data.symbol, price: data.price, ts: data.ts, dir };
    setTicks((prev) => [tick, ...prev].slice(0, 100));
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 80px 60px",
        padding: "3px 6px", borderBottom: "1px solid #333",
        color: "#666", fontSize: 9, letterSpacing: "0.08em", flexShrink: 0,
        background: "#0d0d0d",
      }}>
        <span>SYM</span>
        <span style={{ textAlign: "right" }}>PRICE</span>
        <span style={{ textAlign: "right" }}>TIME</span>
      </div>

      {/* Ticks */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {ticks.map((tick, i) => (
          <div
            key={tick.id}
            style={{
              display: "grid", gridTemplateColumns: "1fr 80px 60px",
              padding: "2px 6px", alignItems: "center",
              borderBottom: "1px solid #1a1a1a",
              background: i === 0 ? "rgba(255,149,0,0.05)" : "transparent",
            }}
          >
            <span style={{
              color: "#ff9500",
              fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {tick.symbol}
            </span>
            <span style={{
              color: tick.dir === "up" ? "#00c853" : tick.dir === "down" ? "#ff1744" : "#fff",
              fontSize: 9,
              textAlign: "right", fontVariantNumeric: "tabular-nums",
            }}>
              {fmt(tick.price)}
            </span>
            <span style={{
              color: "#555", fontSize: 8,
              textAlign: "right", fontVariantNumeric: "tabular-nums",
            }}>
              {fmtTime(tick.ts)}
            </span>
          </div>
        ))}

        {!ticks.length && (
          <div style={{
            padding: 16, color: "#666", fontSize: 10,
            textAlign: "center", letterSpacing: "0.05em",
          }}>
            <span style={{ color: "#ff9500" }}>_</span> WAITING...
          </div>
        )}
      </div>
    </div>
  );
}

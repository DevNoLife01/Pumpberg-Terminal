"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToken, useTokenList, useNewTokenWS, useMarketWS } from "@/lib/api";
import { isMint, fmt, fmtPct } from "@/lib/utils";
import TerminalGrid from "@/components/TerminalGrid";
import TokenFeed from "@/components/TokenFeed";
import TradeFeed from "@/components/TradeFeed";
import AnalyticsPanel from "@/components/AnalyticsPanel";
import TokenSearch from "@/components/TokenSearch";

// ── Bloomberg Header Bar ─────────────────────────────────────────────────
function HeaderBar({ symbol, onSelect }: { symbol: string | null; onSelect: (s: string) => void }) {
  const [time, setTime] = useState("");
  
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      height: 20, background: "#ff8c00", color: "#000",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 6px", fontWeight: "bold", fontSize: 11, flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span>CRYPTO TERMINAL</span>
        <span style={{ fontWeight: "normal", fontSize: 10 }}>SOLANA DEX + PUMP.FUN</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <TokenSearch onSelect={onSelect} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{time}</span>
      </div>
    </div>
  );
}

// ── Ticker Tape ────────────────────────────────────────────────────────────
function TickerTape() {
  const { data } = useTokenList(3000);
  const tokens = data?.tokens?.slice(0, 20) ?? [];

  if (!tokens.length) return null;

  return (
    <div style={{
      height: 16, background: "#000", borderBottom: "1px solid #222",
      overflow: "hidden", fontSize: 10, flexShrink: 0,
    }}>
      <div className="ticker-tape" style={{ display: "flex", whiteSpace: "nowrap" }}>
        {[...tokens, ...tokens].map((t, i) => (
          <span key={i} style={{ marginRight: 24 }}>
            <span style={{ color: "#ff8c00" }}>{t.symbol}</span>
            <span style={{ color: "#fff", margin: "0 4px" }}>{fmt(t.price)}</span>
            <span style={{ color: (t.change_pct ?? 0) >= 0 ? "#0f0" : "#f00" }}>
              {fmtPct(t.change_pct)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Small Panel Header ────────────────────────────────────────────────────
function PanelHeader({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <div className="bb-header">
      <span>{title}</span>
      {extra}
    </div>
  );
}

// ── Status Bar ─────────────────────────────────────────────────────────────
function StatusBar({ symbol, tokenCount, tps }: { symbol: string | null; tokenCount: number; tps: number }) {
  return (
    <div style={{
      height: 16, background: "#111", borderTop: "1px solid #222",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 6px", fontSize: 9, color: "#666", flexShrink: 0,
    }}>
      <div style={{ display: "flex", gap: 16 }}>
        <span><span style={{ color: "#0f0" }}>●</span> CONNECTED</span>
        <span>TOKENS: <span style={{ color: "#ff8c00" }}>{tokenCount}</span></span>
        <span>TPS: <span style={{ color: "#ff8c00" }}>{tps}</span></span>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {symbol && <span>SELECTED: <span style={{ color: "#0ff" }}>{symbol}</span></span>}
        <span>CRYPTO TERMINAL v2.0</span>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function Page() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tps, setTps] = useState(0);
  const tpsRef = useRef(0);
  const { data: tokenList } = useTokenList(2000);

  // TPS counter
  useMarketWS(() => { tpsRef.current++; });
  useEffect(() => {
    const t = setInterval(() => {
      setTps(tpsRef.current);
      tpsRef.current = 0;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const handleSelect = useCallback((s: string) => setSelected(s), []);

  // Resolve mint to symbol
  const isMintAddr = selected != null && isMint(selected);
  const { data: tokenData } = useToken(isMintAddr ? null : selected, 1000);
  const { data: mintResolved } = useToken(isMintAddr ? selected : null, 1000);
  const displaySymbol = isMintAddr ? (mintResolved?.symbol ?? selected) : selected;
  const token = isMintAddr ? mintResolved : tokenData;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      width: "100vw", height: "100vh", overflow: "hidden",
      background: "#000", color: "#ff8c00",
    }}>
      {/* Top orange header */}
      <HeaderBar symbol={displaySymbol} onSelect={handleSelect} />
      
      {/* Scrolling ticker */}
      <TickerTape />

      {/* Main content grid */}
      <div style={{
        flex: 1, display: "grid",
        gridTemplateColumns: "180px 1fr 200px",
        gridTemplateRows: "1fr",
        gap: 1, padding: 1, overflow: "hidden", minHeight: 0,
        background: "#222",
      }}>
        {/* LEFT COLUMN: Token list */}
        <div className="bb-panel" style={{ display: "flex", flexDirection: "column" }}>
          <PanelHeader title="NEW TOKENS" extra={<span style={{ fontSize: 8, fontWeight: "normal" }}>{tokenList?.total ?? 0}</span>} />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TokenFeed selected={displaySymbol} onSelect={handleSelect} />
          </div>
        </div>

        {/* CENTER: Chart grid (2x2) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
          <TerminalGrid symbol={displaySymbol} />
        </div>

        {/* RIGHT COLUMN: Analytics + Trades */}
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
          {/* Analytics panel */}
          <div className="bb-panel" style={{ flex: 1.2, minHeight: 0 }}>
            <PanelHeader title={displaySymbol ? `ANALYTICS - ${displaySymbol}` : "ANALYTICS"} />
            <div style={{ flex: 1, overflow: "auto" }}>
              <AnalyticsPanel token={token} />
            </div>
          </div>

          {/* Trade feed */}
          <div className="bb-panel" style={{ flex: 1, minHeight: 0 }}>
            <PanelHeader title={displaySymbol ? `TRADES - ${displaySymbol}` : "ALL TRADES"} />
            <div style={{ flex: 1, overflow: "hidden" }}>
              <TradeFeed filter={displaySymbol} />
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar symbol={displaySymbol} tokenCount={tokenList?.total ?? 0} tps={tps} />
    </div>
  );
}

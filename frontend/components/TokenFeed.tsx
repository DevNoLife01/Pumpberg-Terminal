"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import useSWR from "swr";
import type { TokenSnapshot } from "@/lib/types";
import { fmtPct } from "@/lib/utils";
import { 
  useNewTokenWS, useTokenList, getNewSolanaPairs, 
  usePumpPortalNewTokens, type DexScreenerToken, type PumpToken, type PumpTrade 
} from "@/lib/api";

interface TokenFeedProps {
  selected: string | null;
  onSelect: (symbol: string) => void;
}

// Convert DexScreener token to our format
function dexToSnapshot(token: DexScreenerToken): TokenSnapshot {
  return {
    symbol: token.baseToken.symbol.toUpperCase(),
    mint: token.baseToken.address,
    price: parseFloat(token.priceUsd || "0"),
    change_pct: token.priceChange?.h24 ?? 0,
    volume_24h: token.volume?.h24 ?? 0,
    trade_count: (token.txns?.h24?.buys ?? 0) + (token.txns?.h24?.sells ?? 0),
    discovered: (token.pairCreatedAt ?? Date.now()) / 1000,
    signal: "-",
    risk: [],
    indicators: {} as any,
    // Extra fields for display
    liquidity: token.liquidity?.usd,
    source: "dex",
  };
}

type TabType = "new" | "trending" | "pump";

export default function TokenFeed({ selected, onSelect }: TokenFeedProps) {
  const [activeTab, setActiveTab] = useState<TabType>("new");
  const { data: pumpData, isLoading: pumpLoading } = useTokenList(5000);
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const [wsTokens, setWsTokens] = useState<TokenSnapshot[]>([]);
  const prevPricesRef = useRef<Record<string, number | null>>({});

  // Fetch new Solana pairs from DexScreener
  const { data: dexPairs, isLoading: dexLoading } = useSWR(
    "dex-new-pairs",
    async () => {
      const pairs = await getNewSolanaPairs();
      return pairs.map(dexToSnapshot);
    },
    { refreshInterval: 10000 }
  );

  // Handle price flashing when data updates
  useEffect(() => {
    const tokens = activeTab === "pump" ? pumpData?.tokens : dexPairs;
    if (tokens) {
      const newFlash: Record<string, "up" | "down"> = {};
      for (const t of tokens) {
        const prev = prevPricesRef.current[t.symbol];
        if (prev != null && t.price != null && prev !== t.price) {
          newFlash[t.symbol] = t.price > prev ? "up" : "down";
        }
        prevPricesRef.current[t.symbol] = t.price;
      }
      if (Object.keys(newFlash).length > 0) {
        setFlash(newFlash);
        setTimeout(() => setFlash({}), 300);
      }
    }
  }, [pumpData, dexPairs, activeTab]);

  // Store prices from trades for pump tokens
  const pumpPricesRef = useRef<Record<string, { price: number; volume: number; trades: number }>>({});

  // Handle new pump.fun token from direct WebSocket
  const handlePumpToken = useCallback((token: PumpToken) => {
    setWsTokens((prev) => {
      if (prev.some((t) => t.mint === token.mint)) return prev;
      const stub: TokenSnapshot = {
        symbol: token.symbol.toUpperCase(),
        mint: token.mint,
        price: token.solAmount && token.initialBuy ? token.solAmount / token.initialBuy : null,
        change_pct: 0,
        volume_24h: token.solAmount ?? 0,
        trade_count: 1,
        discovered: Date.now() / 1000,
        signal: "-",
        risk: [],
        indicators: {} as any,
        source: "pump",
      };
      return [stub, ...prev].slice(0, 100);
    });
  }, []);

  // Handle trade events for pump tokens (updates prices)
  const handlePumpTrade = useCallback((trade: PumpTrade & { price: number }) => {
    const data = pumpPricesRef.current[trade.mint] ?? { price: 0, volume: 0, trades: 0 };
    data.price = trade.price;
    data.volume += trade.solAmount;
    data.trades += 1;
    pumpPricesRef.current[trade.mint] = data;

    // Update token in state with new price
    setWsTokens((prev) => prev.map((t) => {
      if (t.mint !== trade.mint) return t;
      const oldPrice = t.price ?? trade.price;
      const changePct = oldPrice > 0 ? ((trade.price - oldPrice) / oldPrice) * 100 : 0;
      return {
        ...t,
        price: trade.price,
        change_pct: changePct,
        volume_24h: data.volume,
        trade_count: data.trades,
      };
    }));

    // Flash effect
    const token = wsTokens.find(t => t.mint === trade.mint);
    if (token) {
      setFlash(f => ({ ...f, [token.symbol]: trade.txType === "buy" ? "up" : "down" }));
      setTimeout(() => setFlash(f => { const n = { ...f }; delete n[token.symbol]; return n; }), 300);
    }
  }, [wsTokens]);

  // Direct connection to PumpPortal WebSocket (bypasses backend)
  usePumpPortalNewTokens(handlePumpToken, handlePumpTrade);

  // Also try backend WS for tokens it may have from other sources
  useNewTokenWS((ev) => {
    setWsTokens((prev) => {
      if (prev.some((t) => t.mint === ev.mint || t.symbol === ev.symbol)) return prev;
      const stub: TokenSnapshot = {
        symbol: ev.symbol, mint: ev.mint, price: null,
        change_pct: 0, volume_24h: 0, trade_count: 0,
        discovered: ev.ts, signal: "-", risk: [], indicators: {} as any,
        source: "pump",
      };
      return [stub, ...prev].slice(0, 100);
    });
  });

  // Determine which tokens to show based on active tab
  let tokens: TokenSnapshot[] = [];
  let isLoading = false;
  
  if (activeTab === "pump") {
    // Combine tokens from both sources, prioritizing WebSocket data
    const polledTokens = pumpData?.tokens ?? [];
    const wsTokenMints = new Set(wsTokens.map(t => t.mint));
    // Filter out polled tokens that are already in WebSocket data (to avoid duplicates)
    const filteredPolledTokens = polledTokens.filter(t => !wsTokenMints.has(t.mint));
    tokens = [...wsTokens, ...filteredPolledTokens].sort((a, b) => b.discovered - a.discovered);
    isLoading = pumpLoading;
  } else if (activeTab === "new") {
    // Show new pairs from DexScreener sorted by creation time
    tokens = (dexPairs ?? []).sort((a, b) => b.discovered - a.discovered);
    isLoading = dexLoading;
  } else if (activeTab === "trending") {
    // Show by volume
    tokens = (dexPairs ?? []).sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0));
    isLoading = dexLoading;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab switcher */}
      <div style={{
        display: "flex", borderBottom: "1px solid #333",
        background: "#0a0a0a", flexShrink: 0,
      }}>
        {[
          { id: "new" as TabType, label: "NEW", count: dexPairs?.length },
          { id: "trending" as TabType, label: "HOT" },
          { id: "pump" as TabType, label: "PUMP", count: pumpData?.total },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: "4px 0", fontSize: 9, fontWeight: "bold",
              background: activeTab === tab.id ? "#1a1a00" : "transparent",
              border: "none", borderBottom: activeTab === tab.id ? "2px solid #ff8c00" : "2px solid transparent",
              color: activeTab === tab.id ? "#ff8c00" : "#666",
              cursor: "pointer", letterSpacing: "0.5px",
            }}
          >
            {tab.label}
            {tab.count != null && <span style={{ color: "#444", marginLeft: 4 }}>({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* Header row */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 55px 40px",
        padding: "2px 4px", borderBottom: "1px solid #222",
        fontSize: 9, color: "#666", background: "#111", flexShrink: 0,
      }}>
        <span>SYM</span>
        <span style={{ textAlign: "right" }}>PRICE</span>
        <span style={{ textAlign: "right" }}>%24H</span>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {tokens.slice(0, 200).map((token) => {
          const isSelected = token.symbol === selected;
          const flashDir = flash[token.symbol];
          const isUp = (token.change_pct ?? 0) >= 0;

          return (
            <div
              key={`${token.symbol}-${token.mint}`}
              onClick={() => onSelect(token.symbol)}
              className={flashDir === "up" ? "flash-green" : flashDir === "down" ? "flash-red" : ""}
              style={{
                display: "grid", gridTemplateColumns: "1fr 55px 40px",
                padding: "3px 4px", cursor: "pointer", fontSize: 10,
                background: isSelected ? "#332200" : "transparent",
                borderLeft: isSelected ? "2px solid #ff8c00" : "2px solid transparent",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#1a1a00"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                color: isSelected ? "#fff" : "#ff8c00",
                fontWeight: isSelected ? "bold" : "normal",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {token.symbol}
                {(token as any).source === "pump" && (
                  <span style={{ fontSize: 7, color: "#0ff", opacity: 0.6 }}>P</span>
                )}
              </span>
              <span style={{
                color: "#fff", textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}>
                {token.price != null && token.price > 0 
                  ? `$${token.price < 0.001 ? token.price.toExponential(2) : token.price.toFixed(token.price < 1 ? 6 : 4)}`
                  : "—"
                }
              </span>
              <span style={{
                color: isUp ? "#0f0" : "#f00",
                textAlign: "right", fontVariantNumeric: "tabular-nums",
              }}>
                {fmtPct(token.change_pct)}
              </span>
            </div>
          );
        })}

        {tokens.length === 0 && (
          <div style={{ padding: 12, color: "#666", fontSize: 10, textAlign: "center" }}>
            <span className="blink" style={{ color: "#0ff" }}>_</span>
            {isLoading ? " LOADING..." : " NO TOKENS YET"}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "3px 6px", borderTop: "1px solid #222",
        fontSize: 8, color: "#444", background: "#0a0a0a", flexShrink: 0,
      }}>
        {activeTab === "pump" ? `pump.fun LIVE (${wsTokens.length} tokens)` : "DexScreener API"} | Ctrl+K search
      </div>
    </div>
  );
}

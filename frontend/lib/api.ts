"use client";
import useSWR from "swr";
import { useEffect, useRef, useCallback } from "react";
import type { TokenListResponse, TokenSnapshot } from "./types";

const API = "/api";

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

export function useTokenList(refreshInterval = 3000) {
  return useSWR<TokenListResponse>(`${API}/tokens`, fetcher, { refreshInterval });
}

export function useToken(symbol: string | null, refreshInterval = 1000) {
  return useSWR<TokenSnapshot>(
    symbol ? `${API}/token/${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval }
  );
}

export function useTokenByMint(mint: string | null, refreshInterval = 1000) {
  return useSWR<TokenSnapshot>(
    mint ? `${API}/token/mint/${encodeURIComponent(mint)}` : null,
    fetcher,
    { refreshInterval }
  );
}

function getWsUrl(path: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  // Both locally and on Vercel, WebSocket routes are at /api/ws/*
  // The path passed in is like "/ws/market", we need "/api/ws/market"
  return `${proto}://${window.location.host}/api${path}`;
}

/** WebSocket hook — returns latest message and a send function */
export function useMarketWS(onTick: (data: { symbol: string; price: number; ts: number }) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;

    function connect() {
      const wsUrl = getWsUrl("/ws/market");
      if (!wsUrl) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => { attempts = 0; };
      ws.onmessage = (ev) => {
        try { onTickRef.current(JSON.parse(ev.data)); } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        attempts++;
        reconnectTimer = setTimeout(connect, Math.min(2000 * attempts, 10000));
      };
    }
    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);
}

export function useNewTokenWS(onToken: (data: { symbol: string; mint: string; ts: number }) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onRef = useRef(onToken);
  onRef.current = onToken;

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;

    function connect() {
      const wsUrl = getWsUrl("/ws/tokens");
      if (!wsUrl) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => { attempts = 0; };
      ws.onmessage = (ev) => {
        try { onRef.current(JSON.parse(ev.data)); } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        attempts++;
        reconnectTimer = setTimeout(connect, Math.min(2000 * attempts, 10000));
      };
    }
    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);
}

export async function subscribeMint(mint: string, symbol?: string) {
  return fetch(`${API}/token/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mint, symbol }),
  }).then((r) => r.json());
}

// ----- DexScreener API for searching any Solana token -----

export interface DexScreenerToken {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  volume: { h24: number };
  priceChange: { h24: number };
  liquidity?: { usd: number };
  fdv?: number;
  txns?: { h24: { buys: number; sells: number } };
  pairCreatedAt?: number;
}

export interface DexScreenerResponse {
  pairs: DexScreenerToken[];
}

export async function searchDexScreener(query: string): Promise<DexScreenerToken[]> {
  if (!query || query.length < 2) return [];
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data: DexScreenerResponse = await res.json();
    // Filter to Solana tokens only
    return (data.pairs || []).filter(p => p.chainId === "solana").slice(0, 50);
  } catch {
    return [];
  }
}

export async function getTokenByAddress(address: string): Promise<DexScreenerToken | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    if (!res.ok) return null;
    const data: DexScreenerResponse = await res.json();
    const solanaPairs = (data.pairs || []).filter(p => p.chainId === "solana");
    return solanaPairs[0] || null;
  } catch {
    return null;
  }
}

export async function getTrendingTokens(): Promise<DexScreenerToken[]> {
  try {
    // Get boosted tokens from DexScreener (trending/promoted)
    const res = await fetch("https://api.dexscreener.com/token-boosts/top/v1");
    if (!res.ok) return [];
    const data = await res.json();
    // Filter to Solana and return
    const solanaTokens = (data || []).filter((t: any) => t.chainId === "solana").slice(0, 30);
    
    // Get full pair data for these tokens
    const results: DexScreenerToken[] = [];
    for (const t of solanaTokens.slice(0, 10)) {
      const pair = await getTokenByAddress(t.tokenAddress);
      if (pair) results.push(pair);
    }
    return results;
  } catch {
    return [];
  }
}

// Get new pairs on Solana from DexScreener
export async function getNewSolanaPairs(): Promise<DexScreenerToken[]> {
  try {
    const res = await fetch("https://api.dexscreener.com/latest/dex/pairs/solana");
    if (!res.ok) return [];
    const data: DexScreenerResponse = await res.json();
    return (data.pairs || []).slice(0, 100);
  } catch {
    return [];
  }
}

// ----- Direct PumpPortal WebSocket for real-time pump.fun tokens -----
// This connects directly to pumpportal.fun from the browser for instant new token notifications

const PUMP_WS_URL = "wss://pumpportal.fun/api/data";

export interface PumpToken {
  symbol: string;
  mint: string;
  name?: string;
  uri?: string;
  initialBuy?: number;
  solAmount?: number;
  signature?: string;
}

export interface PumpTrade {
  mint: string;
  txType: "buy" | "sell";
  tokenAmount: number;
  solAmount: number;
  newTokenBalance?: number;
  bondingCurveKey?: string;
  vTokensInBondingCurve?: number;
  vSolInBondingCurve?: number;
  marketCapSol?: number;
  signature?: string;
}

/** Direct connection to PumpPortal for new token events */
export function usePumpPortalNewTokens(
  onToken: (token: PumpToken) => void,
  onTrade?: (trade: PumpTrade & { price: number }) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onTokenRef = useRef(onToken);
  const onTradeRef = useRef(onTrade);
  const subscribedMints = useRef<Set<string>>(new Set());
  onTokenRef.current = onToken;
  onTradeRef.current = onTrade;

  const subscribeMint = useCallback((mint: string) => {
    if (subscribedMints.current.has(mint)) return;
    subscribedMints.current.add(mint);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        method: "subscribeTokenTrade",
        keys: [mint]
      }));
    }
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;

    function connect() {
      const ws = new WebSocket(PUMP_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        // Subscribe to new token creations
        ws.send(JSON.stringify({ method: "subscribeNewToken" }));
        // Re-subscribe to any mints we were tracking
        if (subscribedMints.current.size > 0) {
          ws.send(JSON.stringify({
            method: "subscribeTokenTrade",
            keys: Array.from(subscribedMints.current)
          }));
        }
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          
          // New token creation event (has symbol + mint, no txType)
          if (data.symbol && data.mint && !data.txType) {
            onTokenRef.current({
              symbol: data.symbol,
              mint: data.mint,
              name: data.name,
              uri: data.uri,
              initialBuy: data.initialBuy,
              solAmount: data.solAmount,
              signature: data.signature,
            });
            // Auto-subscribe to trades for this new token
            subscribeMint(data.mint);
            return;
          }

          // Trade event
          if (data.mint && data.txType && onTradeRef.current) {
            const tokenAmount = parseFloat(data.tokenAmount) || 1;
            const solAmount = parseFloat(data.solAmount) || 0;
            const price = solAmount / tokenAmount;
            
            onTradeRef.current({
              mint: data.mint,
              txType: data.txType,
              tokenAmount,
              solAmount,
              newTokenBalance: data.newTokenBalance,
              bondingCurveKey: data.bondingCurveKey,
              vTokensInBondingCurve: data.vTokensInBondingCurve,
              vSolInBondingCurve: data.vSolInBondingCurve,
              marketCapSol: data.marketCapSol,
              signature: data.signature,
              price,
            });
          }
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        attempts++;
        reconnectTimer = setTimeout(connect, Math.min(2000 * attempts, 30000));
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [subscribeMint]);

  return { subscribeMint };
}

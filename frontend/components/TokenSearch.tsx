"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { isMint, fmtPct, fmtVolume } from "@/lib/utils";
import { subscribeMint, searchDexScreener, getTokenByAddress, type DexScreenerToken } from "@/lib/api";

interface TokenSearchProps {
  onSelect: (symbolOrMint: string) => void;
}

export default function TokenSearch({ onSelect }: TokenSearchProps) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<DexScreenerToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: Ctrl+K / Cmd+K to focus
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape") {
        setShowResults(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Click outside to close
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    
    setLoading(true);
    setShowResults(true);
    try {
      // Check if it's a contract address (base58, 32-44 chars)
      if (isMint(q)) {
        const token = await getTokenByAddress(q);
        setResults(token ? [token] : []);
      } else {
        const tokens = await searchDexScreener(q);
        setResults(tokens);
      }
      setSelectedIndex(0);
    } catch (e) {
      console.error("Search error:", e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (val: string) => {
    setValue(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(val), 300);
  };

  const handleSelectToken = async (token: DexScreenerToken) => {
    // Subscribe to this token in the backend
    await subscribeMint(token.baseToken.address, token.baseToken.symbol);
    onSelect(token.baseToken.symbol.toUpperCase());
    setValue("");
    setResults([]);
    setShowResults(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults || results.length === 0) return;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      handleSelectToken(results[selectedIndex]);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;

    // If we have results and one is selected, use that
    if (results.length > 0 && results[selectedIndex]) {
      handleSelectToken(results[selectedIndex]);
      return;
    }

    // Otherwise treat as direct symbol/mint
    if (isMint(v)) {
      await subscribeMint(v);
      onSelect(v);
    } else {
      onSelect(v.toUpperCase());
    }
    setValue("");
    setShowResults(false);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "#0d0d0d", border: "1px solid #333",
          padding: "0 8px", height: 28,
        }}>
          <span style={{ color: "#ff9500", fontSize: 10 }}>&gt;</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => { if (results.length > 0) setShowResults(true); }}
            onKeyDown={handleKeyDown}
            placeholder="SEARCH ANY TOKEN (Ctrl+K)"
            style={{
              background: "transparent", border: "none", outline: "none",
              color: "#ff9500", fontSize: 10, flex: 1,
              fontFamily: "inherit", letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
            spellCheck={false}
            autoComplete="off"
          />
          {loading && <span style={{ color: "#0ff", fontSize: 10 }} className="blink">_</span>}
          {value && !loading && (
            <button type="button" onClick={() => { setValue(""); setResults([]); setShowResults(false); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#666", padding: 0, fontSize: 10 }}
            >
              X
            </button>
          )}
        </div>
      </form>

      {/* Search Results Dropdown */}
      {showResults && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0,
          background: "#0a0a0a", border: "1px solid #333", borderTop: "none",
          maxHeight: 300, overflowY: "auto", zIndex: 100,
        }}>
          {loading && (
            <div style={{ padding: 12, textAlign: "center", color: "#666", fontSize: 10 }}>
              SEARCHING ALL SOLANA DEXS...
            </div>
          )}

          {!loading && value.length >= 2 && results.length === 0 && (
            <div style={{ padding: 12, textAlign: "center", color: "#666", fontSize: 10 }}>
              NO TOKENS FOUND
            </div>
          )}

          {!loading && results.map((token, i) => (
            <div
              key={`${token.pairAddress}-${i}`}
              onClick={() => handleSelectToken(token)}
              style={{
                padding: "6px 8px", borderBottom: "1px solid #1a1a1a",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: i === selectedIndex ? "#1a1a00" : "transparent",
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "#ff8c00", fontWeight: "bold", fontSize: 11 }}>
                    {token.baseToken.symbol}
                  </span>
                  <span style={{ color: "#444", fontSize: 9 }}>
                    /{token.quoteToken.symbol}
                  </span>
                </div>
                <div style={{ 
                  color: "#666", fontSize: 8, 
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {token.baseToken.name}
                </div>
              </div>
              
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#fff", fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
                  ${parseFloat(token.priceUsd || "0").toFixed(parseFloat(token.priceUsd || "0") < 0.001 ? 8 : 4)}
                </div>
                <div style={{ 
                  color: (token.priceChange?.h24 ?? 0) >= 0 ? "#0f0" : "#f00", 
                  fontSize: 9, fontVariantNumeric: "tabular-nums",
                }}>
                  {fmtPct(token.priceChange?.h24)}
                </div>
              </div>
              
              <div style={{ textAlign: "right", minWidth: 45 }}>
                <div style={{ color: "#666", fontSize: 8 }}>VOL</div>
                <div style={{ color: "#0ff", fontSize: 9 }}>
                  {fmtVolume(token.volume?.h24)}
                </div>
              </div>
            </div>
          ))}

          {!loading && results.length > 0 && (
            <div style={{ padding: "4px 8px", fontSize: 8, color: "#444", borderTop: "1px solid #222" }}>
              {results.length} results from DexScreener | ↑↓ Navigate | Enter Select
            </div>
          )}
        </div>
      )}
    </div>
  );
}

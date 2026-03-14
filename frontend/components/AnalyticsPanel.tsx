"use client";
import type { TokenSnapshot } from "@/lib/types";
import { fmt, fmtVol } from "@/lib/utils";

interface AnalyticsPanelProps {
  token: TokenSnapshot | null | undefined;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bb-row">
      <span className="bb-label">{label}</span>
      <span className="bb-value" style={{ color: color ?? "#ff9500" }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bb-section">
      <div className="bb-section-header">{title}</div>
      {children}
    </div>
  );
}

export default function AnalyticsPanel({ token }: AnalyticsPanelProps) {
  if (!token) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", color: "#666", fontSize: 10,
        textAlign: "center", padding: 16,
      }}>
        <div>
          <div style={{ color: "#ff9500", fontSize: 14, marginBottom: 8 }}>_</div>
          SELECT TOKEN
        </div>
      </div>
    );
  }

  const ind = token.indicators;
  const isLowRisk = !token.risk?.length || token.risk?.[0] === "LOW RISK";

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <Section title="PRICE">
        <Row label="LAST" value={fmt(token.price)} color="#fff" />
        <Row label="CHG%" value={`${token.change_pct >= 0 ? "+" : ""}${token.change_pct?.toFixed(3)}%`}
          color={token.change_pct >= 0 ? "#00c853" : "#ff1744"} />
        <Row label="VOL" value={fmtVol(token.volume_24h)} />
        <Row label="TRADES" value={String(token.trade_count)} />
      </Section>

      <Section title="SIGNAL">
        <div className="bb-row">
          <span className="bb-label">STATUS</span>
          <span className="bb-value" style={{
            color: token.signal === "STRONG BUY" ? "#00c853" :
                   token.signal === "BUY" ? "#4caf50" :
                   token.signal === "SELL" || token.signal === "STRONG SELL" ? "#ff1744" : "#ff9500"
          }}>
            {token.signal}
          </span>
        </div>
      </Section>

      <Section title="INDICATORS">
        <Row label="EMA20" value={fmt(ind?.ema20)} />
        <Row label="EMA50" value={fmt(ind?.ema50)} />
        <Row label="RSI14" value={ind?.rsi != null ? ind.rsi.toFixed(1) : "—"}
          color={ind?.rsi == null ? "#666" : ind.rsi < 30 ? "#00c853" : ind.rsi > 70 ? "#ff1744" : "#ff9500"}
        />
        <Row label="MACD" value={fmt(ind?.macd)} />
        <Row label="MACD-S" value={fmt(ind?.macd_signal)} />
        <Row label="HIST" value={fmt(ind?.macd_hist)}
          color={(ind?.macd_hist ?? 0) >= 0 ? "#00c853" : "#ff1744"}
        />
        <Row label="BB-U" value={fmt(ind?.bb_upper)} />
        <Row label="BB-M" value={fmt(ind?.bb_mid)} />
        <Row label="BB-L" value={fmt(ind?.bb_lower)} />
      </Section>

      <Section title="RISK">
        {isLowRisk ? (
          <div className="bb-row">
            <span className="bb-label">STATUS</span>
            <span className="bb-value" style={{ color: "#00c853" }}>LOW RISK</span>
          </div>
        ) : (
          token.risk?.map((flag, i) => (
            <div key={i} className="bb-row">
              <span className="bb-label" style={{ color: "#ff1744" }}>WARN</span>
              <span className="bb-value" style={{ color: "#ff1744", fontSize: 9 }}>{flag}</span>
            </div>
          ))
        )}
      </Section>

      <Section title="MINT">
        <div style={{ padding: "4px 8px", fontSize: 8, color: "#666", wordBreak: "break-all", lineHeight: 1.5 }}>
          {token.mint}
        </div>
      </Section>
    </div>
  );
}

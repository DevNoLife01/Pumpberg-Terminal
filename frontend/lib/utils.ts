import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function fmt(n: number | null | undefined, decimals = 6): string {
  if (n == null || isNaN(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(3);
  if (Math.abs(n) < 0.01)     return n.toFixed(8);
  if (Math.abs(n) < 1)        return n.toFixed(6);
  if (Math.abs(n) < 1000)     return n.toFixed(4);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtVol(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function fmtVolume(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function signalColor(signal: string): string {
  if (signal.includes("STRONG BUY"))  return "var(--color-neon-green)";
  if (signal.includes("BUY"))         return "#00cc66";
  if (signal.includes("STRONG SELL")) return "var(--color-neon-red)";
  if (signal.includes("SELL"))        return "#cc2244";
  return "var(--color-neon-amber)";
}

export function riskColor(flags: string[]): string {
  if (!flags || flags.length === 0 || flags[0] === "LOW RISK") return "var(--color-neon-green)";
  const critical = flags.some((f) => f.includes("CRITICAL") || f.includes("PUMP AND DUMP"));
  if (critical) return "var(--color-neon-red)";
  return "var(--color-neon-amber)";
}

/** Returns true if the string looks like a Solana mint (base58, 32-44 chars, no spaces) */
export function isMint(s: string): boolean {
  return s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

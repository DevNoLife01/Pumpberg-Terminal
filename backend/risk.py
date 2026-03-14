"""
backend/risk.py
---------------
Rug-pull and market-risk heuristics.
All functions accept a TokenEntry and return a list of warning strings.
"""

from __future__ import annotations

from typing import List, TYPE_CHECKING

if TYPE_CHECKING:
    from registry import TokenEntry


# ---------------------------------------------------------------------------
# Individual heuristics
# ---------------------------------------------------------------------------

def _check_price_drop(prices: List[float]) -> List[str]:
    """Flag extreme price crashes from the opening trade."""
    if len(prices) < 10:
        return []
    start  = prices[0]
    latest = prices[-1]
    if start == 0:
        return []
    drop = (start - latest) / start
    if drop > 0.80:
        return ["CRITICAL PRICE DROP (>80%)"]
    if drop > 0.60:
        return ["SEVERE PRICE DROP (>60%)"]
    if drop > 0.40:
        return ["LARGE PRICE DROP (>40%)"]
    return []


def _check_pump_and_dump(prices: List[float]) -> List[str]:
    """
    Classic pump-and-dump: price spiked far above open, then crashed
    back below it.
    """
    if len(prices) < 20:
        return []
    start  = prices[0]
    latest = prices[-1]
    peak   = max(prices)
    if start == 0:
        return []
    if peak > start * 5 and latest < start * 1.1:
        return ["PUMP AND DUMP PATTERN DETECTED"]
    if peak > start * 3 and latest < start * 0.8:
        return ["POSSIBLE PUMP AND DUMP"]
    return []


def _check_liquidity_removal(prices: List[float]) -> List[str]:
    """
    Rapid cliff-drop within a short recent window – a proxy for
    sudden liquidity removal.
    """
    if len(prices) < 5:
        return []
    window = prices[-5:]
    drop   = (window[0] - window[-1]) / (window[0] + 1e-10)
    if drop > 0.50:
        return ["POSSIBLE LIQUIDITY REMOVAL (sudden cliff drop)"]
    return []


def _check_volume_spike(token) -> List[str]:
    """Flag tokens whose volume is suspiciously high relative to price."""
    prices = token.price_store.get()
    if not prices or len(prices) < 10:
        return []
    avg_price = sum(prices[-10:]) / 10
    # Heuristic: volume per trade should be proportional to price
    # A very high volume_24h on a very cheap token can indicate wash trading
    if avg_price > 0 and token.volume_24h / avg_price > 1_000_000:
        return ["SUSPICIOUS VOLUME SPIKE (possible wash trading)"]
    return []


def _check_dev_wallet_concentration(token) -> List[str]:
    """
    We infer dev-wallet concentration from early large sell-side trades.
    If the first N trades contain one or more sells that dwarf buys,
    flag it.
    """
    trades = token.recent_trades(30)
    if len(trades) < 5:
        return []
    early   = trades[:10]
    sell_vol = sum(t.size for t in early if t.side == "sell")
    buy_vol  = sum(t.size for t in early if t.side == "buy")
    total    = sell_vol + buy_vol
    if total == 0:
        return []
    if sell_vol / total > 0.75:
        return ["HIGH DEV WALLET CONTROL (heavy early selling)"]
    if sell_vol / total > 0.55:
        return ["ELEVATED SELL PRESSURE (early wallets selling)"]
    return []


def _check_low_liquidity(prices: List[float], trades) -> List[str]:
    """Flag tokens with very few trades or stale price data."""
    if len(trades) < 3:
        return ["LOW LIQUIDITY (very few trades)"]
    if len(prices) < 10:
        return ["LOW LIQUIDITY (insufficient price history)"]
    return []


# ---------------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------------

def analyze_risk(token: "TokenEntry") -> List[str]:
    """
    Run all heuristics and return a combined list of warning strings.
    If no issues are found, returns ["LOW RISK"].
    """
    prices = token.price_store.get()
    trades = token.recent_trades(50)

    flags: List[str] = []

    flags += _check_low_liquidity(prices, trades)
    flags += _check_price_drop(prices)
    flags += _check_pump_and_dump(prices)
    flags += _check_liquidity_removal(prices)
    flags += _check_volume_spike(token)
    flags += _check_dev_wallet_concentration(token)

    # Deduplicate while preserving order
    seen: set = set()
    unique: List[str] = []
    for f in flags:
        if f not in seen:
            seen.add(f)
            unique.append(f)

    return unique if unique else ["LOW RISK"]

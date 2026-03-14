"""
backend/indicators.py
---------------------
Technical indicator calculations.
All functions operate on plain Python lists or pandas Series.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import pandas as pd

from backend.registry import TokenRegistry, TokenEntry, TIMEFRAMES
from backend.streams import MarketEngine
from backend.indicators import compute_indicators, compute_signal
from backend.risk import analyze_risk

# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta    = series.diff()
    gain     = delta.clip(lower=0)
    loss     = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs       = avg_gain / avg_loss.replace(0, 1e-10)
    return 100 - (100 / (1 + rs))


def macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (macd_line, signal_line, histogram)."""
    ema_fast   = series.ewm(span=fast,   adjust=False).mean()
    ema_slow   = series.ewm(span=slow,   adjust=False).mean()
    macd_line  = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram  = macd_line - signal_line
    return macd_line, signal_line, histogram


def bollinger_bands(
    series: pd.Series,
    period: int = 20,
    std: float = 2.0,
) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (upper, middle, lower)."""
    middle = series.rolling(period).mean()
    dev    = series.rolling(period).std()
    return middle + std * dev, middle, middle - std * dev


# ---------------------------------------------------------------------------
# Main compute function – returns a dict of series for the chart
# ---------------------------------------------------------------------------

def compute_indicators(prices: List[float]) -> Optional[pd.DataFrame]:
    """
    Given a list of raw close prices, return a DataFrame with all indicators.
    Returns None if there are fewer than 26 data points.
    """
    if len(prices) < 26:
        return None

    df = pd.DataFrame({"close": prices})

    df["ema20"] = ema(df["close"], 20)
    df["ema50"] = ema(df["close"], 50)
    df["rsi"]   = rsi(df["close"])

    df["macd"], df["macd_signal"], df["macd_hist"] = macd(df["close"])

    upper, mid, lower = bollinger_bands(df["close"])
    df["bb_upper"] = upper
    df["bb_mid"]   = mid
    df["bb_lower"] = lower

    return df


# ---------------------------------------------------------------------------
# Signal engine
# ---------------------------------------------------------------------------

def compute_signal(df: pd.DataFrame) -> str:
    """
    Derive a trading signal from the latest indicator row.
    Score-based: each bullish condition adds points.
    """
    if df is None or len(df) < 2:
        return "INSUFFICIENT DATA"

    row   = df.iloc[-1]
    prev  = df.iloc[-2]
    score = 0

    # RSI oversold
    if row["rsi"] < 30:
        score += 2
    elif row["rsi"] < 45:
        score += 1
    elif row["rsi"] > 70:
        score -= 2

    # EMA trend
    if row["ema20"] > row["ema50"]:
        score += 1
        # Golden-cross momentum
        if prev["ema20"] <= prev["ema50"]:
            score += 1

    # MACD above zero
    if row["macd"] > 0:
        score += 1

    # MACD bullish crossover
    if row["macd"] > row["macd_signal"] and prev["macd"] <= prev["macd_signal"]:
        score += 1

    # Price relative to Bollinger bands
    close = row["close"]
    if close < row["bb_lower"]:
        score += 1
    elif close > row["bb_upper"]:
        score -= 1

    if score >= 4:
        return "STRONG BUY"
    if score == 3:
        return "BUY"
    if score in (1, 2):
        return "NEUTRAL"
    if score == 0:
        return "SELL"
    return "STRONG SELL"

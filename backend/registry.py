"""
backend/registry.py
-------------------
Central data store for all discovered tokens.
TokenRegistry  – thread-safe dictionary of TokenEntry objects.
PriceStore     – rolling price history (deque, configurable max).
CandleBuilder  – converts raw trade prices into OHLC candles.
"""

from __future__ import annotations

import time
import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_PRICE_HISTORY = 2000   # raw trade prices kept per token
MAX_CANDLES       = 500    # candle objects kept per timeframe per token
MAX_TRADES        = 200    # raw trade dicts kept for the live trade feed

TIMEFRAMES = {
    "1s":  1,
    "5s":  5,
    "1m":  60,
    "5m":  300,
    "15m": 900,
}


# ---------------------------------------------------------------------------
# Raw trade entry
# ---------------------------------------------------------------------------

@dataclass
class Trade:
    timestamp: float    # unix epoch (seconds)
    price:     float
    size:      float
    side:      str      # "buy" or "sell"


# ---------------------------------------------------------------------------
# OHLC candle
# ---------------------------------------------------------------------------

@dataclass
class Candle:
    timestamp: float    # open time
    open:      float
    high:      float
    low:       float
    close:     float
    volume:    float


# ---------------------------------------------------------------------------
# PriceStore – rolling list of raw close prices
# ---------------------------------------------------------------------------

class PriceStore:
    """Thread-safe rolling price buffer."""

    def __init__(self, maxlen: int = MAX_PRICE_HISTORY):
        self._prices: deque[float] = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def add(self, price: float) -> None:
        with self._lock:
            self._prices.append(price)

    def get(self) -> List[float]:
        with self._lock:
            return list(self._prices)

    def latest(self) -> Optional[float]:
        with self._lock:
            return self._prices[-1] if self._prices else None


# ---------------------------------------------------------------------------
# CandleBuilder – aggregates trades into OHLC per timeframe
# ---------------------------------------------------------------------------

class CandleBuilder:
    """
    Converts a stream of (timestamp, price, size) into OHLC candles.
    Maintains separate candle lists for every supported timeframe.
    """

    def __init__(self):
        # {tf_label: deque[Candle]}
        self._candles: Dict[str, deque] = {
            tf: deque(maxlen=MAX_CANDLES) for tf in TIMEFRAMES
        }
        # Current open candle per timeframe {tf_label: Candle | None}
        self._open: Dict[str, Optional[Candle]] = {tf: None for tf in TIMEFRAMES}
        self._lock = threading.Lock()

    def add_trade(self, timestamp: float, price: float, size: float) -> None:
        with self._lock:
            for tf, seconds in TIMEFRAMES.items():
                bucket = int(timestamp // seconds) * seconds
                current = self._open[tf]

                if current is None or current.timestamp != bucket:
                    # Close the previous candle
                    if current is not None:
                        self._candles[tf].append(current)
                    # Open a new candle
                    self._open[tf] = Candle(
                        timestamp=bucket,
                        open=price,
                        high=price,
                        low=price,
                        close=price,
                        volume=size,
                    )
                else:
                    # Update current candle
                    current.high   = max(current.high,  price)
                    current.low    = min(current.low,   price)
                    current.close  = price
                    current.volume += size

    def get_candles(self, tf: str) -> List[Candle]:
        """Return closed + open candles for the given timeframe."""
        with self._lock:
            result = list(self._candles.get(tf, deque()))
            open_c = self._open.get(tf)
            if open_c is not None:
                result.append(open_c)
            return result


# ---------------------------------------------------------------------------
# TokenEntry – everything we know about one token
# ---------------------------------------------------------------------------

@dataclass
class TokenEntry:
    symbol:      str
    mint:        str
    discovered:  float = field(default_factory=time.time)
    price_store: PriceStore     = field(default_factory=PriceStore)
    candles:     CandleBuilder  = field(default_factory=CandleBuilder)
    trades:      deque          = field(default_factory=lambda: deque(maxlen=MAX_TRADES))
    volume_24h:  float          = 0.0
    risk_flags:  List[str]      = field(default_factory=list)
    _lock:       threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add_trade(self, price: float, size: float, side: str) -> None:
        ts = time.time()
        t  = Trade(timestamp=ts, price=price, size=size, side=side)
        with self._lock:
            self.trades.append(t)
            self.volume_24h += size * price
        self.price_store.add(price)
        self.candles.add_trade(ts, price, size)

    def latest_price(self) -> Optional[float]:
        return self.price_store.latest()

    def recent_trades(self, n: int = 50) -> List[Trade]:
        with self._lock:
            items = list(self.trades)
        return items[-n:]


# ---------------------------------------------------------------------------
# TokenRegistry – thread-safe global store of all tokens
# ---------------------------------------------------------------------------

class TokenRegistry:
    """
    Central registry for every discovered token (pump.fun + Binance).
    Thread-safe – can be written from async WebSocket tasks and read
    from the PyQt6 UI thread simultaneously.
    """

    def __init__(self):
        self._tokens: Dict[str, TokenEntry] = {}
        self._lock   = threading.Lock()
        # New-token callback list so the UI can be notified
        self._new_token_callbacks: List = []

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def add_token(self, symbol: str, mint: str) -> bool:
        """
        Register a token.  Returns True if it was newly added.
        """
        key = symbol.upper()
        with self._lock:
            if key in self._tokens:
                return False
            self._tokens[key] = TokenEntry(symbol=key, mint=mint)

        # Fire callbacks outside the lock
        for cb in self._new_token_callbacks:
            try:
                cb(key, mint)
            except Exception:
                pass
        return True

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    def get(self, symbol: str) -> Optional[TokenEntry]:
        return self._tokens.get(symbol.upper())

    def get_by_mint(self, mint: str) -> Optional[TokenEntry]:
        """Look up a token by its mint address (case-sensitive)."""
        with self._lock:
            for entry in self._tokens.values():
                if entry.mint == mint:
                    return entry
        return None

    def all_tokens(self) -> List[TokenEntry]:
        with self._lock:
            return list(self._tokens.values())

    def token_count(self) -> int:
        with self._lock:
            return len(self._tokens)

    # ------------------------------------------------------------------
    # Subscriptions
    # ------------------------------------------------------------------

    def on_new_token(self, callback) -> None:
        """Register a callback(symbol, mint) fired when a new token is discovered."""
        self._new_token_callbacks.append(callback)

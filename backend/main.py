"""
backend/main.py
---------------
FastAPI server — exposes the market engine via REST + WebSocket.

Routes (all under /api via vercel.json routePrefix):
  GET  /tokens                     – list all known tokens
  GET  /token/{symbol}             – full snapshot for one token
  GET  /token/mint/{mint}          – lookup by mint address
  WS   /ws/market                  – live price ticks  {symbol, price, side}
  WS   /ws/tokens                  – new token events  {symbol, mint}
  POST /token/subscribe            – subscribe to trades for a mint
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from registry import TokenEntry, TIMEFRAMES
from streams import MarketEngine
from indicators import compute_indicators, compute_signal
from risk import analyze_risk

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)
logger.info("========== BACKEND MODULE LOADED ==========")


# ---------------------------------------------------------------------------
# Connection managers
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self._clients: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.append(ws)

    def disconnect(self, ws: WebSocket):
        self._clients.remove(ws) if ws in self._clients else None

    async def broadcast(self, data: dict):
        dead = []
        for ws in self._clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


price_manager = ConnectionManager()
token_manager = ConnectionManager()

# ---------------------------------------------------------------------------
# Engine (lazy start on first request)
# ---------------------------------------------------------------------------

engine: Optional[MarketEngine] = None
engine_task: Optional[asyncio.Task] = None
engine_started = False


def _on_price(symbol: str, price: float):
    """Called from async context inside engine loop."""
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(
            price_manager.broadcast({"symbol": symbol, "price": price, "ts": time.time()})
        )
    except Exception as e:
        logger.error("_on_price error: %s", e)


def _on_new_token(symbol: str, mint: str):
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(
            token_manager.broadcast({"symbol": symbol, "mint": mint, "ts": time.time()})
        )
    except Exception as e:
        logger.error("_on_new_token error: %s", e)


async def ensure_engine_started():
    """Lazy-start the engine on first request."""
    global engine, engine_task, engine_started
    
    logger.debug("ensure_engine_started called, engine_started=%s", engine_started)
    
    if engine_started:
        return
    
    engine_started = True
    logger.info(">>>>>>>>>> STARTING MARKET ENGINE <<<<<<<<<<")
    
    try:
        engine = MarketEngine(
            on_price_update=_on_price,
            on_new_token=_on_new_token,
        )
        engine._loop = asyncio.get_running_loop()
        engine._mint_queue = asyncio.Queue()
        logger.info("MarketEngine instance created, loop=%s", engine._loop)

        async def _run_engine():
            try:
                logger.info("_run_engine: starting pump.fun stream NOW...")
                await engine.start()
            except Exception as e:
                logger.error("_run_engine crashed: %s", e, exc_info=True)

        engine_task = asyncio.create_task(_run_engine())
        logger.info(">>>>>>>>>> ENGINE TASK CREATED <<<<<<<<<<")
    except Exception as e:
        logger.error("Failed to create engine: %s", e, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Engine is now lazy-started on first request
    logger.info("FastAPI lifespan started")
    yield
    if engine_task:
        engine_task.cancel()
    logger.info("FastAPI lifespan ended")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Crypto Terminal API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_token(token: TokenEntry, include_candles: bool = False) -> dict:
    prices = token.price_store.get()
    df     = compute_indicators(prices)
    signal = compute_signal(df) if df is not None else "INSUFFICIENT DATA"
    risk   = analyze_risk(token)

    latest = token.latest_price()
    prev   = prices[-2] if len(prices) >= 2 else latest
    change_pct = ((latest - prev) / prev * 100) if (latest and prev and prev != 0) else 0.0

    result = {
        "symbol":     token.symbol,
        "mint":       token.mint,
        "price":      latest,
        "change_pct": round(change_pct, 4),
        "volume_24h": round(token.volume_24h, 2),
        "trade_count": len(token.trades),
        "discovered": token.discovered,
        "signal":     signal,
        "risk":       risk,
        "indicators": {},
    }

    if df is not None and len(df):
        row = df.iloc[-1]
        result["indicators"] = {
            "ema20":      _safe(row.get("ema20")),
            "ema50":      _safe(row.get("ema50")),
            "rsi":        _safe(row.get("rsi")),
            "macd":       _safe(row.get("macd")),
            "macd_signal":_safe(row.get("macd_signal")),
            "macd_hist":  _safe(row.get("macd_hist")),
            "bb_upper":   _safe(row.get("bb_upper")),
            "bb_mid":     _safe(row.get("bb_mid")),
            "bb_lower":   _safe(row.get("bb_lower")),
        }

    if include_candles:
        result["candles"] = {}
        result["prices"]  = prices[-500:]
        for tf in TIMEFRAMES:
            candles = token.candles.get_candles(tf)
            result["candles"][tf] = [
                {
                    "t": c.timestamp,
                    "o": c.open,
                    "h": c.high,
                    "l": c.low,
                    "c": c.close,
                    "v": c.volume,
                }
                for c in candles[-300:]
            ]
        # Include full indicator series for charts
        if df is not None:
            result["indicator_series"] = {
                "ema20":      _series(df, "ema20"),
                "ema50":      _series(df, "ema50"),
                "rsi":        _series(df, "rsi"),
                "macd":       _series(df, "macd"),
                "macd_signal":_series(df, "macd_signal"),
                "macd_hist":  _series(df, "macd_hist"),
                "bb_upper":   _series(df, "bb_upper"),
                "bb_mid":     _series(df, "bb_mid"),
                "bb_lower":   _series(df, "bb_lower"),
            }
        # Recent trades
        result["recent_trades"] = [
            {"ts": t.timestamp, "price": t.price, "size": t.size, "side": t.side}
            for t in token.recent_trades(100)
        ]

    return result


def _safe(val) -> Optional[float]:
    try:
        f = float(val)
        return None if (f != f) else round(f, 8)  # NaN check
    except Exception:
        return None


def _series(df, col: str) -> List[Optional[float]]:
    return [_safe(v) for v in df[col].tolist()[-500:]]


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/tokens")
async def list_tokens(limit: int = 200):
    await ensure_engine_started()
    if not engine:
        return {"tokens": []}
    tokens = engine.registry.all_tokens()
    tokens.sort(key=lambda t: t.discovered, reverse=True)
    return {
        "tokens": [_serialize_token(t) for t in tokens[:limit]],
        "total":  engine.registry.token_count(),
    }


@app.get("/token/{symbol}")
async def get_token(symbol: str):
    await ensure_engine_started()
    if not engine:
        raise HTTPException(503, "Engine not ready")
    token = engine.registry.get(symbol.upper())
    if not token:
        raise HTTPException(404, f"Token '{symbol}' not found")
    return _serialize_token(token, include_candles=True)


@app.get("/token/mint/{mint}")
async def get_token_by_mint(mint: str):
    await ensure_engine_started()
    if not engine:
        raise HTTPException(503, "Engine not ready")
    token = engine.registry.get_by_mint(mint)
    if not token:
        raise HTTPException(404, f"Mint '{mint}' not found")
    return _serialize_token(token, include_candles=True)


class SubscribeRequest(BaseModel):
    mint: str
    symbol: Optional[str] = None


@app.post("/token/subscribe")
async def subscribe_token(req: SubscribeRequest):
    await ensure_engine_started()
    if not engine:
        raise HTTPException(503, "Engine not ready")
    symbol = req.symbol or req.mint[:8].upper()
    engine.registry.add_token(symbol, req.mint)
    engine.subscribe_mint(req.mint)
    return {"status": "subscribed", "symbol": symbol, "mint": req.mint}


@app.get("/health")
async def health():
    await ensure_engine_started()
    return {"status": "ok", "tokens": engine.registry.token_count() if engine else 0}


@app.get("/test")
async def test():
    """Simple test endpoint to verify backend is working."""
    logger.info("TEST ENDPOINT HIT")
    return {"test": "ok", "engine_started": engine_started, "engine_exists": engine is not None}


@app.get("/debug")
async def debug():
    """Debug endpoint to check engine state."""
    await ensure_engine_started()
    if not engine:
        return {"engine": None}
    return {
        "engine_exists": True,
        "loop_exists": engine._loop is not None,
        "queue_exists": engine._mint_queue is not None,
        "token_count": engine.registry.token_count(),
        "sample_tokens": [
            {"symbol": t.symbol, "mint": t.mint[:12] + "...", "trades": len(t.trades)}
            for t in engine.registry.all_tokens()[:5]
        ],
    }


# ---------------------------------------------------------------------------
# WebSocket endpoints
# ---------------------------------------------------------------------------

@app.websocket("/ws/market")
async def ws_market(ws: WebSocket):
    await ensure_engine_started()
    await price_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()   # keep alive / ignore client messages
    except WebSocketDisconnect:
        price_manager.disconnect(ws)


@app.websocket("/ws/tokens")
async def ws_tokens(ws: WebSocket):
    await ensure_engine_started()
    await token_manager.connect(ws)
    # Send current token list immediately on connect
    if engine:
        tokens = engine.registry.all_tokens()
        tokens.sort(key=lambda t: t.discovered, reverse=True)
        for token in tokens[:50]:
            await ws.send_json({"symbol": token.symbol, "mint": token.mint, "ts": token.discovered})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        token_manager.disconnect(ws)

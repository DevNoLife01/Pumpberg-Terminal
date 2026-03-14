"""
backend/main.py
FastAPI backend for Pumpberg Terminal
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.registry import TokenEntry, TIMEFRAMES
from backend.streams import MarketEngine
from backend.indicators import compute_indicators, compute_signal
from backend.risk import analyze_risk


# ----------------------------------------------------------
# Logging
# ----------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)

logger = logging.getLogger("pumpberg")


# ----------------------------------------------------------
# WebSocket connection manager
# ----------------------------------------------------------

class ConnectionManager:

    def __init__(self):
        self.clients: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, data: dict):

        dead = []

        for ws in self.clients:

            try:
                await ws.send_json(data)
            except:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)


price_manager = ConnectionManager()
token_manager = ConnectionManager()


# ----------------------------------------------------------
# Engine
# ----------------------------------------------------------

engine: Optional[MarketEngine] = None
engine_task: Optional[asyncio.Task] = None


def on_price(symbol: str, price: float):

    asyncio.create_task(
        price_manager.broadcast({
            "symbol": symbol,
            "price": price,
            "ts": time.time()
        })
    )


def on_new_token(symbol: str, mint: str):

    asyncio.create_task(
        token_manager.broadcast({
            "symbol": symbol,
            "mint": mint,
            "ts": time.time()
        })
    )


# ----------------------------------------------------------
# Lifespan
# ----------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):

    global engine
    global engine_task

    logger.info("Starting Pumpberg engine...")

    engine = MarketEngine(
        on_price_update=on_price,
        on_new_token=on_new_token
    )

    engine_task = asyncio.create_task(engine.start())

    yield

    logger.info("Stopping Pumpberg engine")

    if engine_task:
        engine_task.cancel()


# ----------------------------------------------------------
# App
# ----------------------------------------------------------

app = FastAPI(
    title="Pumpberg Terminal API",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------
# Models
# ----------------------------------------------------------

class SubscribeRequest(BaseModel):
    mint: str
    symbol: Optional[str] = None


# ----------------------------------------------------------
# Helpers
# ----------------------------------------------------------

def serialize_token(token: TokenEntry, include_candles=False):

    prices = token.price_store.get()

    df = compute_indicators(prices)

    signal = compute_signal(df) if df is not None else "NEUTRAL"

    risk = analyze_risk(token)

    latest = token.latest_price()

    return {
        "symbol": token.symbol,
        "mint": token.mint,
        "price": latest,
        "signal": signal,
        "risk": risk,
        "volume_24h": token.volume_24h,
        "trade_count": len(token.trades),
        "discovered": token.discovered,
    }


# ----------------------------------------------------------
# REST
# ----------------------------------------------------------

@app.get("/tokens")
async def tokens():

    if not engine:
        return {"tokens": []}

    tokens = engine.registry.all_tokens()

    tokens.sort(key=lambda t: t.discovered, reverse=True)

    return {
        "tokens": [serialize_token(t) for t in tokens[:200]],
        "total": engine.registry.token_count()
    }


@app.get("/token/{symbol}")
async def token(symbol: str):

    if not engine:
        raise HTTPException(503)

    t = engine.registry.get(symbol.upper())

    if not t:
        raise HTTPException(404)

    return serialize_token(t, True)


@app.get("/token/mint/{mint}")
async def token_by_mint(mint: str):

    if not engine:
        raise HTTPException(503)

    t = engine.registry.get_by_mint(mint)

    if not t:
        raise HTTPException(404)

    return serialize_token(t, True)


@app.post("/token/subscribe")
async def subscribe(req: SubscribeRequest):

    if not engine:
        raise HTTPException(503)

    symbol = req.symbol or req.mint[:8]

    engine.registry.add_token(symbol, req.mint)

    engine.subscribe_mint(req.mint)

    return {"status": "ok"}


@app.get("/health")
async def health():

    return {
        "status": "ok",
        "tokens": engine.registry.token_count() if engine else 0
    }


# ----------------------------------------------------------
# WebSockets
# ----------------------------------------------------------

@app.websocket("/ws/market")
async def ws_market(ws: WebSocket):

    await price_manager.connect(ws)

    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        price_manager.disconnect(ws)


@app.websocket("/ws/tokens")
async def ws_tokens(ws: WebSocket):

    await token_manager.connect(ws)

    if engine:

        tokens = engine.registry.all_tokens()

        tokens.sort(key=lambda t: t.discovered, reverse=True)

        for token in tokens[:50]:

            await ws.send_json({
                "symbol": token.symbol,
                "mint": token.mint,
                "ts": token.discovered
            })

    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        token_manager.disconnect(ws)
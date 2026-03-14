"""
backend/main.py
Pumpberg Backend API
"""

import asyncio
import logging
import time
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


import streams

from backend.registry import TokenRegistry, TokenEntry, TIMEFRAMES
from backend.streams import MarketEngine
from backend.indicators import compute_indicators, compute_signal
from backend.risk import analyze_risk


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

logger = logging.getLogger("pumpberg")


# -------------------------
# WebSocket manager
# -------------------------

class ConnectionManager:

    def __init__(self):
        self.clients: List[WebSocket] = []

    async def connect(self, ws: WebSocket):

        await ws.accept()
        self.clients.append(ws)

    def disconnect(self, ws: WebSocket):

        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, data):

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


# -------------------------
# Engine
# -------------------------

engine: Optional[streams.MarketEngine] = None


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


# -------------------------
# FastAPI
# -------------------------

app = FastAPI(title="Pumpberg API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------
# Startup
# -------------------------

@app.on_event("startup")
async def startup():

    global engine

    logger.info("Starting Market Engine")

    engine = streams.MarketEngine(
        on_price_update=on_price,
        on_new_token=on_new_token
    )

    asyncio.create_task(engine.start())


# -------------------------
# Models
# -------------------------

class SubscribeRequest(BaseModel):

    mint: str
    symbol: Optional[str] = None


# -------------------------
# REST API
# -------------------------

@app.get("/tokens")
async def tokens():

    if not engine:
        return {"tokens": []}

    tokens = engine.registry.all_tokens()

    tokens.sort(key=lambda t: t.discovered, reverse=True)

    return {
        "tokens": [
            {
                "symbol": t.symbol,
                "mint": t.mint,
                "price": t.latest_price(),
                "volume": t.volume_24h,
                "trades": len(t.trades)
            }
            for t in tokens[:200]
        ]
    }


@app.get("/token/{symbol}")
async def token(symbol: str):

    if not engine:
        raise HTTPException(503)

    t = engine.registry.get(symbol.upper())

    if not t:
        raise HTTPException(404)

    return {
        "symbol": t.symbol,
        "mint": t.mint,
        "price": t.latest_price(),
        "volume": t.volume_24h,
        "trades": len(t.trades)
    }


@app.post("/token/subscribe")
async def subscribe(req: SubscribeRequest):

    if not engine:
        raise HTTPException(503)

    symbol = req.symbol or req.mint[:8]

    engine.registry.add_token(symbol, req.mint)

    engine.subscribe_mint(req.mint)

    return {"status": "subscribed"}


@app.get("/health")
async def health():

    return {
        "status": "ok",
        "tokens": engine.registry.token_count() if engine else 0
    }


# -------------------------
# WebSockets
# -------------------------

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

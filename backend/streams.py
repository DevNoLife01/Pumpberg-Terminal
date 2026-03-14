"""
backend/streams.py
Robust Pump.fun streaming backend

Features
--------

• Single PumpPortal websocket (required by API)
• Auto reconnect with exponential backoff
• Proper async queue consumption
• Deduplicated mint subscriptions
• Safe message parsing
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable, Optional, Set

import websockets
from websockets.exceptions import ConnectionClosedError, WebSocketException

from registry import TokenRegistry

logger = logging.getLogger(__name__)

PUMP_WS = "wss://pumpportal.fun/api/data"

BACKOFF_START = 1
BACKOFF_MAX = 60


# ---------------------------------------------------------
# PumpPortal Stream
# ---------------------------------------------------------

async def pump_stream(
    registry: TokenRegistry,
    subscribe_queue: asyncio.Queue,
    on_new_token: Optional[Callable[[str, str], None]] = None,
    on_price: Optional[Callable[[str, float], None]] = None,
):

    subscribed: Set[str] = set()

    backoff = BACKOFF_START

    while True:

        try:

            logger.info("Connecting to PumpPortal...")

            async with websockets.connect(
                PUMP_WS,
                ping_interval=20,
                ping_timeout=30,
            ) as ws:

                logger.info("Connected to PumpPortal")

                backoff = BACKOFF_START

                await ws.send(json.dumps({
                    "method": "subscribeNewToken"
                }))

                logger.info("Subscribed to new tokens")

                consumer = asyncio.create_task(
                    _mint_subscription_worker(ws, subscribe_queue, subscribed)
                )

                async for msg in ws:

                    try:

                        data = json.loads(msg)

                    except Exception:
                        continue

                    # -------------------------------------------------
                    # NEW TOKEN EVENT
                    # -------------------------------------------------

                    if "mint" in data and "symbol" in data and "txType" not in data:

                        symbol = data["symbol"].upper()
                        mint = data["mint"]

                        added = registry.add_token(symbol, mint)

                        if added:

                            logger.info(f"New token: {symbol} {mint[:8]}")

                            if on_new_token:
                                on_new_token(symbol, mint)

                            await subscribe_queue.put(mint)

                        continue

                    # -------------------------------------------------
                    # TRADE EVENT
                    # -------------------------------------------------

                    mint = data.get("mint")

                    if not mint:
                        continue

                    price = None

                    if "price" in data:
                        price = float(data["price"])

                    elif "solAmount" in data and "tokenAmount" in data:

                        token_amt = float(data["tokenAmount"]) or 1e-10
                        price = float(data["solAmount"]) / token_amt

                    if not price or price <= 0:
                        continue

                    size = float(data.get("tokenAmount", 0))

                    side = "sell" if data.get("txType") == "sell" else "buy"

                    token = registry.get_by_mint(mint)

                    if token:

                        token.add_trade(price, size, side)

                        if on_price:
                            on_price(token.symbol, price)

                consumer.cancel()

        except (ConnectionClosedError, WebSocketException) as e:

            logger.warning(f"PumpPortal connection closed: {e}")

        except Exception as e:

            logger.error(f"PumpPortal error: {e}", exc_info=True)

        logger.info(f"Reconnecting in {backoff}s")

        await asyncio.sleep(backoff)

        backoff = min(backoff * 2, BACKOFF_MAX)


# ---------------------------------------------------------
# Subscription Worker
# ---------------------------------------------------------

async def _mint_subscription_worker(
    ws,
    queue: asyncio.Queue,
    subscribed: Set[str]
):

    while True:

        mint = await queue.get()

        if mint in subscribed:
            continue

        subscribed.add(mint)

        try:

            await ws.send(json.dumps({
                "method": "subscribeTokenTrade",
                "keys": [mint]
            }))

            logger.info(f"Subscribed trades: {mint[:8]}")

        except Exception as e:

            logger.warning(f"Subscription failed: {e}")


# ---------------------------------------------------------
# Market Engine
# ---------------------------------------------------------

class MarketEngine:

    def __init__(
        self,
        on_price_update: Optional[Callable[[str, float], None]] = None,
        on_new_token: Optional[Callable[[str, str], None]] = None
    ):

        self.registry = TokenRegistry()

        self.on_price = on_price_update
        self.on_new_token = on_new_token

        self.mint_queue: asyncio.Queue = asyncio.Queue()

    async def start(self):

        logger.info("MarketEngine starting...")

        await pump_stream(
            registry=self.registry,
            subscribe_queue=self.mint_queue,
            on_new_token=self.on_new_token,
            on_price=self.on_price
        )
# backend/registry.py

from backend.registry import TokenRegistry, TokenEntry, TIMEFRAMES
from backend.streams import MarketEngine
from backend.indicators import compute_indicators, compute_signal
from backend.risk import analyze_risk

class Token:

    def __init__(self, symbol, mint):

        self.symbol = symbol
        self.mint = mint

        self.trades = []
        self.last_price = None

    def add_trade(self, price, size, side):

        self.last_price = price

        self.trades.append({
            "price": price,
            "size": size,
            "side": side
        })


class TokenRegistry:

    def __init__(self):

        self.tokens_by_symbol = {}
        self.tokens_by_mint = {}

    def add_token(self, symbol, mint):

        if mint in self.tokens_by_mint:
            return False

        token = Token(symbol, mint)

        self.tokens_by_symbol[symbol] = token
        self.tokens_by_mint[mint] = token

        return True

    def get(self, symbol):

        return self.tokens_by_symbol.get(symbol.upper())

    def get_by_mint(self, mint):

        return self.tokens_by_mint.get(mint)

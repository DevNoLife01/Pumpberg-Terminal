# Crypto Terminal

A Bloomberg-style crypto trading terminal built with Python, PyQt6, and pyqtgraph.

## Requirements

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or pip

## Install dependencies

```bash
uv sync
# or
pip install PyQt6 pyqtgraph websockets pandas numpy
```

## Run

```bash
python main.py
# or
uv run main.py
```

## Layout

```
┌────────────────────────────────────────────────────────────┐
│  TOP BAR  [search field]          [status]  [clock]        │
├──────────┬──────────────────────────────────┬──────────────┤
│  LEFT    │   CENTER – candlestick chart     │  RIGHT       │
│  New     │   EMA 20 / EMA 50 overlays       │  Analytics   │
│  Token   │   RSI sub-panel                  │  Signal      │
│  Feed    │   Timeframe: 1s/5s/1m/5m/15m     │  Risk flags  │
├──────────┴──────────────────────────────────┴──────────────┤
│  BOTTOM – live trade feed table                            │
└────────────────────────────────────────────────────────────┘
```

## Project structure

```
crypto_terminal/
  main.py
  pyproject.toml
  backend/
    __init__.py
    registry.py    # TokenRegistry, PriceStore, CandleBuilder
    indicators.py  # EMA, RSI, MACD, Bollinger + signal engine
    risk.py        # Rug-pull heuristics
    streams.py     # Resilient WebSocket streams (pump.fun + Binance)
  ui/
    __init__.py
    charts.py      # CandlestickItem + ChartWidget (pyqtgraph)
    panels.py      # NewTokenPanel, AnalyticsPanel, TradeFeedPanel
    main_window.py # MainWindow + async/Qt bridge
```

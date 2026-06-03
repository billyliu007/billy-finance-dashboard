#!/usr/bin/env python3
"""
WorthTrack MCP Server (stdio)
Wraps the WorthTrack REST API directly — no relay, no rate limits.
"""

import os
import urllib.request
import json
from mcp.server.fastmcp import FastMCP

BASE_URL = os.environ.get("WORTHTRACK_API_BASE_URL", "https://api.myworthtrack.com")
API_TOKEN = os.environ["WORTHTRACK_API_TOKEN"]

mcp = FastMCP("worthtrack")


def _get(path: str) -> dict:
    url = BASE_URL + path
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


@mcp.tool()
def get_net_worth() -> dict:
    """
    Fetch total net worth and component breakdown (always in USD).

    Returns:
        baseCurrency: "USD"
        totalNetWorth: float — total net worth in USD
        hasData: bool
        missingInputs: list[str] — components that could not be valued
        componentValues: list of {key, name, value, valueUsd, found}
    """
    return _get("/api/v1/me/net-worth")


@mcp.tool()
def get_cash() -> dict:
    """
    Fetch cash balances across all accounts.

    Returns a breakdown of cash holdings by account/currency,
    with totals converted to USD.
    """
    return _get("/api/v1/me/cash")


@mcp.tool()
def get_holdings() -> dict:
    """
    Fetch all investment holdings (stocks, ETFs, crypto, etc.).

    Returns a list of positions with quantity, cost basis,
    current value, and gain/loss — all in USD.
    """
    return _get("/api/v1/me/holdings")


@mcp.tool()
def get_scenario_plan() -> dict:
    """
    Fetch the active financial scenario/projection plan.

    Returns projected net worth over time based on the user's
    configured scenario assumptions. Returns 404 if no active
    scenario has been set.
    """
    return _get("/api/v1/me/scenario-plan")


@mcp.tool()
def get_position_transactions(ticker: str) -> dict:
    """
    Fetch transaction history for a specific position.

    Args:
        ticker: The ticker symbol or position identifier (e.g. "AAPL", "BTC").

    Returns a list of buy/sell transactions for that position.
    """
    return _get(f"/api/v1/me/positions/{ticker}/transactions")


@mcp.tool()
def get_asset_performance(ticker: str, from_date: str = None, to_date: str = None) -> dict:
    """
    Fetch realized trading performance for a specific asset, optionally filtered by date range.

    Args:
        ticker:     Ticker symbol, e.g. "TSLA", "AAPL", "BTC". Case-insensitive.
        from_date:  Start date in YYYY-MM-DD format (inclusive). Optional.
        to_date:    End date in YYYY-MM-DD format (inclusive). Optional.

    Returns:
        scope:              { symbol } — the requested ticker (uppercased)
        availableSymbols:   list of symbols that have at least one SELL in the date range
        summary.realized:   { pnl, pct } — total realized P&L in USD and % return
        summary.winStats:   { winRate, avgWin, avgLoss, profitFactor }
        summary.asset:      { tradeCount, totalRealizedPnlUsd, avgCostBasisPerUnit,
                              avgSoldPricePerUnit, avgPnlUsdPerTrade, currency }
        timeSeries.monthlyStacked: cumulative realized P&L by month
        trades.details:     list of individual SELL transactions, chronological
                            each with { id, txDate, symbol, qty, proceeds, cost,
                                        pnl, currency, returnPct, pnlUsd }
        trades.distributions.tradeReturnHistogram: return % bucket counts

    Note: Only SELL transactions are included — unrealized gains are not reflected.
          All totals (pnl, pnlUsd) are USD-normalized.
    """
    params = [f"symbol={ticker.upper().strip()}"]
    if from_date:
        params.append(f"from={from_date}")
    if to_date:
        params.append(f"to={to_date}")
    query = "?" + "&".join(params)
    return _get(f"/api/v1/me/trading-performance{query}")


@mcp.tool()
def get_net_worth_history(from_date: str = None, to_date: str = None) -> dict:
    """
    Fetch historical daily net worth snapshots.

    Args:
        from_date: Start date YYYY-MM-DD (inclusive). Optional.
        to_date:   End date YYYY-MM-DD (inclusive). Optional.

    Returns:
        baseCurrency: "USD"
        history: list of { date, totalUsd, totalCny }
                 totalCny is null when the CNY rate was unavailable that day.
    """
    params = []
    if from_date:
        params.append(f"from={from_date}")
    if to_date:
        params.append(f"to={to_date}")
    query = ("?" + "&".join(params)) if params else ""
    return _get(f"/api/v1/me/net-worth/history{query}")


if __name__ == "__main__":
    mcp.run(transport="stdio")

#!/usr/bin/env python3
"""
WorthTrack MCP Server (stdio) — multi-account ready.

Wraps the WorthTrack REST API directly. The API token and the server's
advertised name are read from the environment so the SAME file can be
registered multiple times (one per MyWorthTrack account) under different
names, each with its own token.

Read tools: net worth, cash, holdings, scenario plan, transactions,
performance, history. Write tools (record real trades via
POST /api/v1/me/trades): buy_stock, sell_stock, buy_crypto, sell_crypto.

Required env:
    WORTHTRACK_TOKEN         WorthTrack personal access token (bfpat_...)
Optional env:
    WORTHTRACK_SERVER_NAME   Server name (default "worthtrack"); set a
                             distinct value per instance (e.g. "worthtrack2")
    WORTHTRACK_BASE_URL      API base (default https://api.myworthtrack.com)
"""

import os
import sys
import json
import urllib.request
import urllib.error
import urllib.parse
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

BASE_URL = os.environ.get("WORTHTRACK_BASE_URL", "https://api.myworthtrack.com").rstrip("/")
SERVER_NAME = os.environ.get("WORTHTRACK_SERVER_NAME", "worthtrack")

# Fail fast and loudly (to stderr — never stdout, which is the MCP transport)
# if the token is missing, instead of sending unauthenticated requests.
API_TOKEN = os.environ.get("WORTHTRACK_TOKEN")
if not API_TOKEN:
    print(
        f"[{SERVER_NAME}] FATAL: WORTHTRACK_TOKEN is not set in the environment.",
        file=sys.stderr,
    )
    sys.exit(1)

mcp = FastMCP(SERVER_NAME)


def _get(path: str, params: dict | None = None) -> dict:
    """GET a WorthTrack endpoint, returning parsed JSON or a structured error dict."""
    url = BASE_URL + path
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url += "?" + urllib.parse.urlencode(clean)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if e.code == 404:
            return {"ok": False, "status": 404, "error": "not_found"}
        return {"ok": False, "status": e.code, "error": body[:500]}
    except (urllib.error.URLError, TimeoutError) as e:
        return {"ok": False, "error": f"network_error: {e}"}
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid_json_from_api"}


def _post(path: str, body: dict) -> dict:
    """
    POST JSON to a WorthTrack endpoint. On API errors, returns the API's own
    {message, code, details} plus ok=False and status, so the caller can explain
    e.g. insufficient_holding to the user.
    """
    clean = {k: v for k, v in body.items() if v is not None}
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(clean).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"message": raw[:500]}
        return {"ok": False, "status": e.code, **(parsed if isinstance(parsed, dict) else {"message": raw[:500]})}
    except (urllib.error.URLError, TimeoutError) as e:
        return {"ok": False, "error": f"network_error: {e}"}
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid_json_from_api"}


# Write tools change the user's real portfolio: not read-only, not idempotent
# (calling twice records two trades).
_READ = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True)


@mcp.tool(annotations=_READ)
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


@mcp.tool(annotations=_READ)
def get_cash() -> dict:
    """
    Fetch cash balances across all accounts.

    Returns a breakdown of cash holdings by account/currency,
    with totals converted to USD.
    """
    return _get("/api/v1/me/cash")


@mcp.tool(annotations=_READ)
def get_holdings() -> dict:
    """
    Fetch all investment holdings (stocks, ETFs, crypto, etc.).

    Returns a list of positions with quantity, cost basis,
    current value, and gain/loss — all in USD.
    """
    return _get("/api/v1/me/holdings")


@mcp.tool(annotations=_READ)
def get_scenario_plan() -> dict:
    """
    Fetch the active financial scenario/projection plan.

    Returns projected net worth over time based on the user's
    configured scenario assumptions. Returns {"ok": false, "status": 404}
    if no active scenario has been set.
    """
    return _get("/api/v1/me/scenario-plan")


@mcp.tool(annotations=_READ)
def get_position_transactions(ticker: str) -> dict:
    """
    Fetch transaction history for a specific position.

    Args:
        ticker: The ticker symbol or position identifier (e.g. "AAPL", "BTC").

    Returns a list of buy/sell transactions for that position.
    """
    safe = urllib.parse.quote(ticker.strip(), safe="")
    return _get(f"/api/v1/me/positions/{safe}/transactions")


@mcp.tool(annotations=_READ)
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
        trades.distributions.tradeReturnHistogram: return % bucket counts

    Note: Only SELL transactions are included — unrealized gains are not reflected.
          All totals (pnl, pnlUsd) are USD-normalized.
    """
    params = {"symbol": ticker.upper().strip(), "from": from_date, "to": to_date}
    return _get("/api/v1/me/trading-performance", params)


@mcp.tool(annotations=_READ)
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
    params = {"from": from_date, "to": to_date}
    return _get("/api/v1/me/net-worth/history", params)


# --- Trades (write) -------------------------------------------------------------------
# All four tools call POST /api/v1/me/trades and record a REAL transaction.
# Confirm the details with the user before calling, and call once per trade.
#
# Common result on success: {ok: true, assetCreated, trade: {...}, holding: {symbol, currency, qty, avgCost}}
# On failure: {ok: false, status, message, code, details?}. Notable codes:
#   insufficient_holding  sell qty > holding (details: {held, requested}); nothing recorded
#   unknown_symbol        new asset not found (unknown US stock / no USDT-USDC Coinbase market)
#   asset_type_mismatch   symbol already held as the other asset type
#   trade_rejected        e.g. cash account not found or wrong currency


@mcp.tool(annotations=_WRITE)
def buy_stock(
    symbol: str,
    qty: float,
    price_per_unit: float,
    fee: float = None,
    date: str = None,
    cash_account_id: str = None,
    notes: str = None,
) -> dict:
    """
    Record a stock purchase (US stocks/ETFs, priced in USD). Records a real transaction —
    confirm with the user first.

    If the user doesn't hold the stock yet, it is added first with a 0 holding, then the
    purchase is recorded.

    Args:
        symbol:          Ticker, e.g. "AAPL".
        qty:             Shares bought (> 0, fractional allowed).
        price_per_unit:  Price per share in USD.
        fee:             Optional flat commission in USD.
        date:            Trade date YYYY-MM-DD (default: today, UTC).
        cash_account_id: Optional USD cash account id (from get_cash) to deduct qty*price+fee from.
        notes:           Optional note.
    """
    return _post("/api/v1/me/trades", {
        "assetType": "stock", "side": "buy", "symbol": symbol.strip().upper(), "qty": qty,
        "pricePerUnit": price_per_unit, "fee": fee, "date": date,
        "cashAccountId": cash_account_id, "notes": notes,
    })


@mcp.tool(annotations=_WRITE)
def sell_stock(
    symbol: str,
    qty: float,
    price_per_unit: float,
    fee: float = None,
    date: str = None,
    cash_account_id: str = None,
    notes: str = None,
) -> dict:
    """
    Record a stock sale. Records a real transaction — confirm with the user first.

    Fails with code "insufficient_holding" (details: held, requested) if qty is more than
    the user holds; nothing is recorded in that case.

    Args:
        symbol:          Ticker, e.g. "AAPL".
        qty:             Shares sold (> 0).
        price_per_unit:  Sale price per share in USD.
        fee:             Optional flat commission in USD.
        date:            Trade date YYYY-MM-DD (default: today, UTC).
        cash_account_id: Optional USD cash account id (from get_cash) to credit qty*price-fee to.
        notes:           Optional note.
    """
    return _post("/api/v1/me/trades", {
        "assetType": "stock", "side": "sell", "symbol": symbol.strip().upper(), "qty": qty,
        "pricePerUnit": price_per_unit, "fee": fee, "date": date,
        "cashAccountId": cash_account_id, "notes": notes,
    })


@mcp.tool(annotations=_WRITE)
def buy_crypto(
    symbol: str,
    qty: float,
    price_per_unit: float = None,
    fee: float = None,
    total_amount: float = None,
    fee_in_crypto: float = None,
    quote_currency: str = None,
    date: str = None,
    cash_account_id: str = None,
    notes: str = None,
) -> dict:
    """
    Record a crypto purchase (priced in USDT/USDC). Records a real transaction — confirm
    with the user first.

    Give EITHER price_per_unit OR total_amount (not both):

      1. Unit price:   qty + price_per_unit (+ optional fee, flat, in USDT/USDC).
      2. Total amount: qty = gross coins received + total_amount = USDT/USDC spent
                       (+ optional fee_in_crypto = fee taken in the coin). The API records
                       net qty = qty - fee_in_crypto at price = total_amount / net qty.
                       Use this when the user knows what they paid and what they received.

    If the user doesn't hold the coin yet, it is added first with a 0 holding using its
    Coinbase USDT market (or USDC; force with quote_currency), then the purchase is recorded.

    Args:
        symbol:          Coin, e.g. "BTC", "ETH", "SOL".
        qty:             Coins bought (> 0); gross amount in total-amount mode.
        price_per_unit:  Price per coin in USDT/USDC (unit-price mode).
        fee:             Optional flat fee in USDT/USDC (unit-price mode only).
        total_amount:    Total USDT/USDC spent (total-amount mode).
        fee_in_crypto:   Optional fee charged in the coin (total-amount mode only).
        quote_currency:  "USDT" or "USDC" — only used when the coin is new to the portfolio.
        date:            Trade date YYYY-MM-DD (default: today, UTC).
        cash_account_id: Optional USDT/USDC cash account id (from get_cash) to deduct from.
        notes:           Optional note.
    """
    if (price_per_unit is None) == (total_amount is None):
        return {"ok": False, "code": "invalid_input_mode",
                "message": "Provide exactly one of price_per_unit or total_amount."}
    return _post("/api/v1/me/trades", {
        "assetType": "crypto", "side": "buy", "symbol": symbol.strip().upper(), "qty": qty,
        "pricePerUnit": price_per_unit, "fee": fee,
        "totalAmount": total_amount, "feeInCrypto": fee_in_crypto,
        "quoteCurrency": quote_currency.strip().upper() if quote_currency else None,
        "date": date, "cashAccountId": cash_account_id, "notes": notes,
    })


@mcp.tool(annotations=_WRITE)
def sell_crypto(
    symbol: str,
    qty: float,
    price_per_unit: float,
    fee: float = None,
    date: str = None,
    cash_account_id: str = None,
    notes: str = None,
) -> dict:
    """
    Record a crypto sale (priced in USDT/USDC). Records a real transaction — confirm with
    the user first.

    Fails with code "insufficient_holding" (details: held, requested) if qty is more than
    the user holds; nothing is recorded in that case.

    Args:
        symbol:          Coin, e.g. "BTC".
        qty:             Coins sold (> 0).
        price_per_unit:  Sale price per coin in USDT/USDC.
        fee:             Optional flat fee in USDT/USDC.
        date:            Trade date YYYY-MM-DD (default: today, UTC).
        cash_account_id: Optional USDT/USDC cash account id (from get_cash) to credit proceeds to.
        notes:           Optional note.
    """
    return _post("/api/v1/me/trades", {
        "assetType": "crypto", "side": "sell", "symbol": symbol.strip().upper(), "qty": qty,
        "pricePerUnit": price_per_unit, "fee": fee, "date": date,
        "cashAccountId": cash_account_id, "notes": notes,
    })


if __name__ == "__main__":
    mcp.run(transport="stdio")

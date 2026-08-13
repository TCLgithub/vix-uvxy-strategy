# VIX < 14 → UVXY Quick-Pop Strategy

Backtest + Monte Carlo verification of a discretionary idea: when VIX (normally
15-18) drops below 14, it's read as "coiled" for an upward spike, so go long
UVXY and take profit fast on a 3% pop. This folder holds the quant
verification; a web app (chart + order page) is the next phase, pending a
decision on whether/how to trade this given the results below.

## Bottom line

**As originally specified (3% take-profit, no stop beyond -15%, VIX<14
trigger), this strategy loses money badly and should not be traded as-is.**
Monte Carlo puts the probability of a net loss over a similarly-sized future
trade sequence at ~96%. See `Output/report` (or re-run to regenerate) for the
full writeup with charts.

Why: UVXY's daily volatility means a 3% pop happens often (79.6% of trades
hit the take-profit) but the rare adverse moves are much larger than 3% —
UVXY structurally decays/gaps hard when a spike doesn't materialize. Average
win (+3.0%) is dwarfed by average loss (-14.5%), so the strategy has a high
win rate but strongly negative expectancy (profit factor 0.81). A
random-entry control test shows the VIX<14 *timing signal itself* does carry
real edge (it beats random entry days ~85% of the time on total return) —
the problem is specifically the tight 3%-and-out exit rule, not the entry
trigger.

A parameter sweep (`sweep.py`) found better-behaved exits — e.g. take profit
at 10%, stop loss at -5%, max hold 5 days — with positive expectancy
(+0.47%/trade, profit factor 1.16), but even the best combination found still
carries a ~61% max drawdown for a ~4.5%/yr CAGR, which is a poor risk/reward
trade-off relative to the drawdown risk. No combination tested turns this into
an obviously attractive strategy.

## Files

- `backtest.py` — data loader (VIX + split-adjusted UVXY via yfinance),
  event-driven backtest engine, bootstrap Monte Carlo, and a random-entry
  control-group Monte Carlo (statistical significance check for the VIX<14
  signal vs. chance). Run with `python backtest.py`.
- `sweep.py` — parameter sensitivity sweep over take-profit / stop-loss /
  max-hold-days combinations. Run with `python sweep.py`.
- `prep_report_data.py` — packages backtest + sweep + Monte Carlo output into
  `report_data.json` for the report/web app.
- `trades.csv` — every simulated trade (signal date, entry/exit, return,
  exit reason).
- `equity_curve.csv`, `equity_curve.png` — compounded equity curve assuming
  100% capital redeployed per trade (one position at a time).
- `results.json` — full summary stats + Monte Carlo results.
- `sweep_results.json` — all 120 parameter combinations tested.
- `monte_carlo_dist.png` — bootstrap vs. random-control return distributions.
- `report_data.json` — chart-ready data (equity curve, MC histograms, sweep
  table) consumed by the HTML report / will back the web app's chart page.
- `web/` — scaffold for the planned web app (React/Vite frontend + Express
  server, matching the layout of the other apps in this repo, e.g.
  `../Screener`).

## Strategy definition tested

- **Signal**: VIX daily close < 14.
- **Entry**: next trading day's open in UVXY (avoids lookahead).
- **Exit** (whichever comes first): +3% from entry (take profit), -15% from
  entry (stop loss), or 15 trading days elapsed (max hold), in that priority
  order if two trigger the same day.
- **Sizing**: one position at a time; equity curve compounds 100% of capital
  per trade (aggressive — real position sizing would use less).
- **Data**: split-adjusted UVXY (Yahoo Finance `auto_adjust=True`, handles
  UVXY's reverse splits) from its 2011-10-04 inception through the present;
  ^VIX close over the same window.

Config constants live at the top of `backtest.py` — change
`VIX_THRESHOLD` / `TAKE_PROFIT_PCT` / `STOP_LOSS_PCT` / `MAX_HOLD_DAYS` /
`COOLDOWN_DAYS` and re-run to test a variant.

## Verification methodology

1. **Historical backtest** — the rules above run once over the full
   2011-2026 history: 235 trades.
2. **Bootstrap Monte Carlo** (10,000 iterations) — resamples the 235
   realized trade returns with replacement to see the distribution of
   outcomes a similarly-sized *future* sequence of trades could produce,
   rather than trusting the one historical path.
3. **Random-entry control Monte Carlo** (5,000 iterations) — runs the exact
   same exit rule from randomly chosen entry days (not gated on VIX<14) to
   test whether the VIX<14 signal actually adds edge over UVXY's baseline
   volatility, or whether the historical result could be explained by chance.

## Caveats

- UVXY's reverse splits are handled via Yahoo's adjusted close, but real
  fills would also face bid/ask spread and slippage, especially around
  volatility spikes — not modeled here, and would make the -15%-stop trades
  worse in practice.
- 100%-of-capital compounding per trade is a stress test, not a realistic
  sizing plan — it exaggerates the speed of ruin. The *average return per
  trade* (independent of sizing) is what shows the strategy's edge is
  negative, not the compounding assumption.
- 235 trades over ~14 years is a modest sample for a rare regime (VIX<14);
  the bootstrap MC accounts for this by showing the spread of outcomes, not
  just one point estimate.

## Web app

`web/` is a working React + Vite + Express app (same pattern as `../Screener`):

```bash
cd web
npm install
npm start        # server/index.js on :3011 (proxied), vite on :3010
```

or use the `vix-uvxy-strategy` entry in the repo-level `.claude/launch.json`.

- **Chart page** — live VIX/UVXY quotes (30s poll, via `yahoo-finance2`),
  a signal banner showing distance to the 14.00 trigger, 6-day price
  sparklines, and the backtest headline stats + equity curve pulled from
  `report_data.json`.
- **Order page** — a manual trade journal (log entry price/date/target/stop,
  live P&L against the current UVXY quote, close/delete). It does **not**
  send orders to a broker.

**Not yet built**: live IBKR order execution. That's a separate, larger
follow-up — it needs the IBKR API/Gateway running locally as a bridge even
if the web frontend is hosted publicly, plus safety limits (position size
caps, confirmation step) before it should be able to submit real orders.
The Order page's manual journal is the interim way to track trades.

## Deployment

Not yet pushed to GitHub or deployed. Plan: push this folder to a GitHub
repo, then deploy `web/` to a free host (Render/Vercel/Fly.io) so it's
reachable by a public link, per the original ask. Waiting on a repo URL.

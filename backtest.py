"""
VIX<14 -> UVXY quick-pop strategy: backtest + Monte Carlo verification.

Strategy being tested (as described by the user):
  - VIX normally sits 15-18. When VIX closes below a threshold (default 14),
    that's read as "coiled" / high chance of an upward VIX spike.
  - On that signal, go long UVXY (next day's open, to avoid lookahead).
  - Take profit quickly: exit as soon as UVXY is up TAKE_PROFIT_PCT from entry
    (checked against the day's high, filled at the TP level).
  - Risk control: a stop-loss (UVXY decays hard when VIX stays calm) and a
    max holding period, since "very short periods" implies no multi-week holds.
  - Only one position open at a time.

Outputs:
  - trades.csv                 every simulated trade
  - equity_curve.csv           compounded equity curve over the trade sequence
  - results.json               all summary stats + Monte Carlo results (for the web app)
  - equity_curve.png           chart
  - monte_carlo_dist.png       chart
"""
import json
import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
VIX_THRESHOLD = 14.0
TAKE_PROFIT_PCT = 0.03      # 3% pop -> take profit
STOP_LOSS_PCT = -0.15       # UVXY can gap hard against you; cap the downside
MAX_HOLD_DAYS = 15          # "very short periods" -> force an exit if it drags
COOLDOWN_DAYS = 1           # trading days to wait after an exit before re-arming
N_BOOTSTRAP = 10000         # Monte Carlo trade-resampling iterations
N_RANDOM_CONTROL = 5000     # Monte Carlo random-entry control iterations
OUT_DIR = "."

rng = np.random.default_rng(42)


def flatten(df, ticker):
    df = df.copy()
    df.columns = [c[0] for c in df.columns]
    return df


def load_data():
    vix = yf.download("^VIX", period="max", progress=False, auto_adjust=True)
    uvxy = yf.download("UVXY", period="max", progress=False, auto_adjust=True)
    vix = flatten(vix, "^VIX")
    uvxy = flatten(uvxy, "UVXY")
    df = pd.DataFrame({
        "vix_close": vix["Close"],
        "uvxy_open": uvxy["Open"],
        "uvxy_high": uvxy["High"],
        "uvxy_low": uvxy["Low"],
        "uvxy_close": uvxy["Close"],
    }).dropna()
    return df


def run_backtest(df, entry_days_idx, tp=TAKE_PROFIT_PCT, sl=STOP_LOSS_PCT,
                  max_hold=MAX_HOLD_DAYS, cooldown=COOLDOWN_DAYS):
    """
    entry_days_idx: sorted array of integer positions (into df) that are
    candidate SIGNAL days (close of that day triggers a next-day-open entry).
    A trade is only opened from a candidate day if we are flat and not in
    cooldown. Returns a list of trade dicts.
    """
    n = len(df)
    trades = []
    in_position = False
    cooldown_until = -1
    entry_set = set(entry_days_idx.tolist())
    i = 0
    while i < n - 1:
        if not in_position and i in entry_set and i >= cooldown_until:
            entry_i = i + 1  # next day open
            if entry_i >= n:
                break
            entry_price = df["uvxy_open"].iloc[entry_i]
            tp_price = entry_price * (1 + tp)
            sl_price = entry_price * (1 + sl)
            exit_i = None
            exit_price = None
            exit_reason = None
            last_i = min(entry_i + max_hold, n - 1)
            for j in range(entry_i, last_i + 1):
                hi = df["uvxy_high"].iloc[j]
                lo = df["uvxy_low"].iloc[j]
                hit_sl = lo <= sl_price
                hit_tp = hi >= tp_price
                if hit_sl and hit_tp:
                    # conservative: assume stop hit first
                    exit_i, exit_price, exit_reason = j, sl_price, "stop_loss"
                    break
                elif hit_sl:
                    exit_i, exit_price, exit_reason = j, sl_price, "stop_loss"
                    break
                elif hit_tp:
                    exit_i, exit_price, exit_reason = j, tp_price, "take_profit"
                    break
            if exit_i is None:
                exit_i = last_i
                exit_price = df["uvxy_close"].iloc[exit_i]
                exit_reason = "max_hold"

            ret = exit_price / entry_price - 1
            trades.append({
                "signal_date": str(df.index[i].date()),
                "entry_date": str(df.index[entry_i].date()),
                "exit_date": str(df.index[exit_i].date()),
                "entry_price": round(float(entry_price), 4),
                "exit_price": round(float(exit_price), 4),
                "return_pct": round(float(ret) * 100, 3),
                "hold_days": int(exit_i - entry_i),
                "exit_reason": exit_reason,
                "vix_at_signal": round(float(df["vix_close"].iloc[i]), 2),
            })
            in_position = False
            cooldown_until = exit_i + 1 + cooldown
            i = exit_i + 1
            continue
        i += 1
    return trades


def summarize(trades, label):
    if not trades:
        return {"label": label, "n_trades": 0}
    rets = np.array([t["return_pct"] for t in trades]) / 100.0
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    equity = np.cumprod(1 + rets)
    running_max = np.maximum.accumulate(equity)
    drawdown = equity / running_max - 1
    max_dd = drawdown.min()
    total_return = equity[-1] - 1
    win_rate = len(wins) / len(rets)
    profit_factor = (wins.sum() / -losses.sum()) if losses.sum() != 0 else np.inf
    hold_days = np.array([t["hold_days"] for t in trades])
    # simple Sharpe-like: per-trade return mean/std (not annualized, trades are irregular)
    sharpe_per_trade = rets.mean() / rets.std() if rets.std() > 0 else np.nan
    first_date = pd.to_datetime(trades[0]["signal_date"])
    last_date = pd.to_datetime(trades[-1]["exit_date"])
    years = max((last_date - first_date).days / 365.25, 0.01)
    cagr = (equity[-1]) ** (1 / years) - 1
    return {
        "label": label,
        "n_trades": len(trades),
        "win_rate_pct": round(win_rate * 100, 2),
        "avg_return_pct": round(rets.mean() * 100, 3),
        "median_return_pct": round(float(np.median(rets)) * 100, 3),
        "avg_win_pct": round(wins.mean() * 100, 3) if len(wins) else None,
        "avg_loss_pct": round(losses.mean() * 100, 3) if len(losses) else None,
        "best_trade_pct": round(rets.max() * 100, 3),
        "worst_trade_pct": round(rets.min() * 100, 3),
        "profit_factor": round(float(profit_factor), 3) if np.isfinite(profit_factor) else None,
        "total_compounded_return_pct": round(total_return * 100, 2),
        "cagr_pct": round(cagr * 100, 2),
        "max_drawdown_pct": round(float(max_dd) * 100, 2),
        "avg_hold_days": round(float(hold_days.mean()), 2),
        "sharpe_per_trade": round(float(sharpe_per_trade), 3) if not np.isnan(sharpe_per_trade) else None,
        "exit_reason_counts": pd.Series([t["exit_reason"] for t in trades]).value_counts().to_dict(),
        "period_start": trades[0]["signal_date"],
        "period_end": trades[-1]["exit_date"],
    }


def bootstrap_mc(trades, n_iter=N_BOOTSTRAP):
    """Resample the realized trade returns with replacement to see the
    distribution of outcomes a similarly-sized future trade sequence could produce."""
    rets = np.array([t["return_pct"] for t in trades]) / 100.0
    n = len(rets)
    final_returns = np.empty(n_iter)
    max_drawdowns = np.empty(n_iter)
    for k in range(n_iter):
        sample = rng.choice(rets, size=n, replace=True)
        equity = np.cumprod(1 + sample)
        running_max = np.maximum.accumulate(equity)
        dd = (equity / running_max - 1).min()
        final_returns[k] = equity[-1] - 1
        max_drawdowns[k] = dd
    return final_returns, max_drawdowns


def random_control_mc(df, real_trades, n_control_trades, n_iter=N_RANDOM_CONTROL):
    """
    Statistical-significance check: if we entered UVXY on completely random
    days (same number of trades as the real signal produced) with the exact
    same TP/SL/max-hold exit rule, how often would random entries do as well
    as (or better than) the VIX<14 signal? This tells us whether the signal
    itself carries edge, or whether the result is just explained by UVXY's
    general volatility profile.
    """
    n = len(df)
    valid_start = 0
    valid_end = n - MAX_HOLD_DAYS - 2
    real_summary = summarize(real_trades, "real")
    real_total_return = real_summary["total_compounded_return_pct"]
    real_win_rate = real_summary["win_rate_pct"]

    control_total_returns = np.empty(n_iter)
    control_win_rates = np.empty(n_iter)
    for k in range(n_iter):
        rand_days = rng.choice(np.arange(valid_start, valid_end),
                                size=min(n_control_trades * 3, valid_end - valid_start),
                                replace=False)
        rand_days.sort()
        ctrl_trades = run_backtest(df, rand_days)
        # trim/pad to same trade count as real strategy for fair comparison
        ctrl_trades = ctrl_trades[:n_control_trades]
        if not ctrl_trades:
            control_total_returns[k] = 0
            control_win_rates[k] = 0
            continue
        s = summarize(ctrl_trades, "control")
        control_total_returns[k] = s["total_compounded_return_pct"]
        control_win_rates[k] = s["win_rate_pct"]

    pct_rank_return = float((control_total_returns < real_total_return).mean() * 100)
    pct_rank_winrate = float((control_win_rates < real_win_rate).mean() * 100)
    return {
        "n_iter": n_iter,
        "control_total_return_mean_pct": round(float(control_total_returns.mean()), 2),
        "control_total_return_median_pct": round(float(np.median(control_total_returns)), 2),
        "control_win_rate_mean_pct": round(float(control_win_rates.mean()), 2),
        "real_total_return_pct": real_total_return,
        "real_win_rate_pct": real_win_rate,
        "real_beats_random_pct_of_time_by_return": round(pct_rank_return, 1),
        "real_beats_random_pct_of_time_by_winrate": round(pct_rank_winrate, 1),
        "control_total_returns_sample": control_total_returns.tolist(),
    }


def main():
    print("Loading VIX and UVXY history...")
    df = load_data()
    print(f"UVXY data from {df.index[0].date()} to {df.index[-1].date()} ({len(df)} trading days)")

    signal_days = np.where(df["vix_close"].values < VIX_THRESHOLD)[0]
    signal_days = signal_days[signal_days < len(df) - 1]
    print(f"Days with VIX < {VIX_THRESHOLD}: {len(signal_days)}")

    trades = run_backtest(df, signal_days)
    print(f"Trades generated: {len(trades)}")

    summary = summarize(trades, "VIX<14 signal")
    print(json.dumps(summary, indent=2))

    # Monte Carlo #1: bootstrap resample of realized trade returns
    boot_returns, boot_dd = bootstrap_mc(trades)
    mc_bootstrap = {
        "n_iter": N_BOOTSTRAP,
        "final_return_pct_p5": round(float(np.percentile(boot_returns, 5)) * 100, 2),
        "final_return_pct_p25": round(float(np.percentile(boot_returns, 25)) * 100, 2),
        "final_return_pct_p50": round(float(np.percentile(boot_returns, 50)) * 100, 2),
        "final_return_pct_p75": round(float(np.percentile(boot_returns, 75)) * 100, 2),
        "final_return_pct_p95": round(float(np.percentile(boot_returns, 95)) * 100, 2),
        "prob_net_loss_pct": round(float((boot_returns < 0).mean()) * 100, 2),
        "max_drawdown_p5_pct": round(float(np.percentile(boot_dd, 5)) * 100, 2),
        "max_drawdown_p50_pct": round(float(np.percentile(boot_dd, 50)) * 100, 2),
        "prob_drawdown_worse_than_30pct": round(float((boot_dd < -0.30).mean()) * 100, 2),
    }
    print("\nBootstrap Monte Carlo (resampled trade sequences):")
    print(json.dumps(mc_bootstrap, indent=2))

    # Monte Carlo #2: random-entry control group (is the signal actually better than chance?)
    print("\nRunning random-entry control simulation (this checks if VIX<14 has real edge)...")
    control = random_control_mc(df, trades, len(trades))
    print(json.dumps({k: v for k, v in control.items() if k != "control_total_returns_sample"}, indent=2))

    # ---- save outputs ----
    pd.DataFrame(trades).to_csv(f"{OUT_DIR}/trades.csv", index=False)

    rets = np.array([t["return_pct"] for t in trades]) / 100.0
    equity = np.cumprod(1 + rets)
    eq_df = pd.DataFrame({
        "trade_num": range(1, len(trades) + 1),
        "exit_date": [t["exit_date"] for t in trades],
        "equity": equity,
    })
    eq_df.to_csv(f"{OUT_DIR}/equity_curve.csv", index=False)

    results = {
        "config": {
            "vix_threshold": VIX_THRESHOLD,
            "take_profit_pct": TAKE_PROFIT_PCT * 100,
            "stop_loss_pct": STOP_LOSS_PCT * 100,
            "max_hold_days": MAX_HOLD_DAYS,
            "cooldown_days": COOLDOWN_DAYS,
        },
        "data_range": {"start": str(df.index[0].date()), "end": str(df.index[-1].date()), "n_days": len(df)},
        "summary": summary,
        "monte_carlo_bootstrap": mc_bootstrap,
        "monte_carlo_random_control": {k: v for k, v in control.items() if k != "control_total_returns_sample"},
        "current_vix": round(float(df["vix_close"].iloc[-1]), 2),
        "current_uvxy": round(float(df["uvxy_close"].iloc[-1]), 2),
    }
    with open(f"{OUT_DIR}/results.json", "w") as f:
        json.dump(results, f, indent=2)

    # ---- charts ----
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(eq_df["trade_num"], eq_df["equity"], marker="o", ms=3)
    ax.axhline(1.0, color="gray", ls="--", lw=1)
    ax.set_title(f"VIX<{VIX_THRESHOLD} -> UVXY {TAKE_PROFIT_PCT*100:.0f}% TP strategy: equity curve ({len(trades)} trades)")
    ax.set_xlabel("Trade #")
    ax.set_ylabel("Equity (compounded, starts at 1.0)")
    fig.tight_layout()
    fig.savefig(f"{OUT_DIR}/equity_curve.png", dpi=130)

    fig2, ax2 = plt.subplots(figsize=(10, 5))
    ax2.hist(boot_returns * 100, bins=60, alpha=0.7, label="Bootstrap of real signal's trades")
    ax2.hist(control["control_total_returns_sample"], bins=60, alpha=0.5, label="Random-entry control")
    ax2.axvline(summary["total_compounded_return_pct"], color="red", lw=2, label="Actual historical result")
    ax2.set_title("Monte Carlo: distribution of total compounded return")
    ax2.set_xlabel("Total compounded return (%)")
    ax2.legend()
    fig2.tight_layout()
    fig2.savefig(f"{OUT_DIR}/monte_carlo_dist.png", dpi=130)

    print("\nSaved: trades.csv, equity_curve.csv, results.json, equity_curve.png, monte_carlo_dist.png")


if __name__ == "__main__":
    main()

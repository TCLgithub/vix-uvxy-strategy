"""
VIX>25 -> SVXY mean-reversion strategy: backtest + Monte Carlo verification.

Mirror-image test of backtest.py's VIX<14 -> UVXY momentum idea. Thesis: after
VIX spikes to an elevated level, it tends to mean-revert back down (the
"volatility risk premium" - a real, documented phenomenon, unlike the momentum
idea). SVXY (short VIX futures, -0.5x since Feb 2018) profits as VIX falls.

Strategy:
  - VIX closes above VIX_THRESHOLD (elevated/fear) -> buy SVXY next day's open.
  - Take profit +TAKE_PROFIT_PCT, stop loss STOP_LOSS_PCT (short-vol tail risk
    is real -- see Feb 2018 Volmageddon, which killed XIV outright -- so the
    stop matters even more here than in the momentum test).
  - Max hold MAX_HOLD_DAYS trading days.
  - One position at a time.

Caveat: SVXY changed leverage from -1x to -0.5x after Feb 2018 (in response to
Volmageddon). Pre/post-2018 trades are not fully apples-to-apples; flagged in
output, not corrected for (correcting would need synthetic re-leveraging that
introduces its own assumptions).

Reuses the generic backtest engine from backtest.py unchanged -- SVXY OHLC is
loaded into the same uvxy_* column names so run_backtest/summarize/bootstrap_mc/
random_control_mc all work as-is.
"""
import json
import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from backtest import run_backtest, summarize, bootstrap_mc, random_control_mc

VIX_THRESHOLD = 25.0        # "elevated" VIX -- buy the mean-reversion trade
TAKE_PROFIT_PCT = 0.10
STOP_LOSS_PCT = -0.20
MAX_HOLD_DAYS = 20
COOLDOWN_DAYS = 1
N_BOOTSTRAP = 10000
N_RANDOM_CONTROL = 5000
SVXY_LEVERAGE_CHANGE_DATE = "2018-02-28"  # -1x -> -0.5x after Volmageddon

rng = np.random.default_rng(42)


def flatten(df):
    df = df.copy()
    df.columns = [c[0] for c in df.columns]
    return df


def load_data():
    vix = yf.download("^VIX", period="max", progress=False, auto_adjust=True)
    svxy = yf.download("SVXY", period="max", progress=False, auto_adjust=True)
    vix = flatten(vix)
    svxy = flatten(svxy)
    df = pd.DataFrame({
        "vix_close": vix["Close"],
        "uvxy_open": svxy["Open"],
        "uvxy_high": svxy["High"],
        "uvxy_low": svxy["Low"],
        "uvxy_close": svxy["Close"],
    }).dropna()
    return df


def main():
    print("Loading VIX and SVXY history...")
    df = load_data()
    print(f"SVXY data from {df.index[0].date()} to {df.index[-1].date()} ({len(df)} trading days)")

    signal_days = np.where(df["vix_close"].values > VIX_THRESHOLD)[0]
    signal_days = signal_days[signal_days < len(df) - 1]
    print(f"Days with VIX > {VIX_THRESHOLD}: {len(signal_days)}")

    trades = run_backtest(df, signal_days, tp=TAKE_PROFIT_PCT, sl=STOP_LOSS_PCT,
                           max_hold=MAX_HOLD_DAYS, cooldown=COOLDOWN_DAYS)
    print(f"Trades generated: {len(trades)}")

    n_pre2018 = sum(1 for t in trades if t["entry_date"] < SVXY_LEVERAGE_CHANGE_DATE)
    n_post2018 = len(trades) - n_pre2018
    print(f"Trades pre-Feb-2018 (-1x leverage): {n_pre2018}, post (-0.5x leverage): {n_post2018}")

    summary = summarize(trades, "VIX>25 signal (SVXY)")
    print(json.dumps(summary, indent=2))

    boot_returns, boot_dd = bootstrap_mc(trades, n_iter=N_BOOTSTRAP)
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
        "prob_drawdown_worse_than_50pct": round(float((boot_dd < -0.50).mean()) * 100, 2),
    }
    print("\nBootstrap Monte Carlo:")
    print(json.dumps(mc_bootstrap, indent=2))

    print("\nRunning random-entry control simulation...")
    control = random_control_mc(df, trades, len(trades), n_iter=N_RANDOM_CONTROL)
    control_sample = control.pop("control_total_returns_sample")
    print(json.dumps(control, indent=2))

    pd.DataFrame(trades).to_csv("trades_svxy.csv", index=False)

    rets = np.array([t["return_pct"] for t in trades]) / 100.0
    equity = np.cumprod(1 + rets)
    eq_df = pd.DataFrame({
        "trade_num": range(1, len(trades) + 1),
        "exit_date": [t["exit_date"] for t in trades],
        "equity": equity,
    })
    eq_df.to_csv("equity_curve_svxy.csv", index=False)

    results = {
        "config": {
            "vix_threshold": VIX_THRESHOLD,
            "take_profit_pct": TAKE_PROFIT_PCT * 100,
            "stop_loss_pct": STOP_LOSS_PCT * 100,
            "max_hold_days": MAX_HOLD_DAYS,
            "cooldown_days": COOLDOWN_DAYS,
            "instrument": "SVXY",
        },
        "leverage_note": {
            "pre_2018_leverage": "-1.0x",
            "post_2018_leverage": "-0.5x",
            "change_date": SVXY_LEVERAGE_CHANGE_DATE,
            "n_trades_pre": n_pre2018,
            "n_trades_post": n_post2018,
        },
        "data_range": {"start": str(df.index[0].date()), "end": str(df.index[-1].date()), "n_days": len(df)},
        "summary": summary,
        "monte_carlo_bootstrap": mc_bootstrap,
        "monte_carlo_random_control": control,
        "current_vix": round(float(df["vix_close"].iloc[-1]), 2),
        "current_svxy": round(float(df["uvxy_close"].iloc[-1]), 2),
    }
    with open("results_svxy.json", "w") as f:
        json.dump(results, f, indent=2)

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(eq_df["trade_num"], eq_df["equity"], marker="o", ms=3, color="teal")
    ax.axhline(1.0, color="gray", ls="--", lw=1)
    ax.axvline(n_pre2018 + 0.5, color="orange", ls=":", lw=1.5, label="Feb 2018 leverage change (-1x -> -0.5x)")
    ax.set_title(f"VIX>{VIX_THRESHOLD} -> SVXY mean-reversion: equity curve ({len(trades)} trades)")
    ax.set_xlabel("Trade #")
    ax.set_ylabel("Equity (compounded, starts at 1.0)")
    ax.legend()
    fig.tight_layout()
    fig.savefig("equity_curve_svxy.png", dpi=130)

    print("\nSaved: trades_svxy.csv, equity_curve_svxy.csv, results_svxy.json, equity_curve_svxy.png")


if __name__ == "__main__":
    main()

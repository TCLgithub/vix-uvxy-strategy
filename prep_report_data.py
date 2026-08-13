"""Precompute everything the HTML report artifact needs: equity curve points,
Monte Carlo histogram bins (bootstrap + random control), sweep table, key stats."""
import json
import numpy as np
import pandas as pd
from backtest import load_data, run_backtest, summarize, bootstrap_mc, random_control_mc, VIX_THRESHOLD

df = load_data()
trades = json.loads(pd.read_csv("trades.csv").to_json(orient="records"))
summary = summarize(trades, "real")

boot_returns, boot_dd = bootstrap_mc(trades)
control = random_control_mc(df, trades, len(trades))
control_sample = np.array(control.pop("control_total_returns_sample"))

def hist(data, bins, lo, hi):
    counts, edges = np.histogram(data, bins=bins, range=(lo, hi))
    return {"counts": counts.tolist(), "edges": edges.tolist()}

boot_pct = boot_returns * 100  # decimal fraction -> percent
control_pct = control_sample  # already stored as percent by random_control_mc
lo = min(boot_pct.min(), control_pct.min())
hi = max(boot_pct.max(), control_pct.max())
boot_hist = hist(boot_pct, 50, lo, hi)
control_hist = hist(control_pct, 50, lo, hi)

eq = pd.read_csv("equity_curve.csv")
equity_points = list(zip(eq["trade_num"].tolist(), eq["equity"].tolist()))

sweep = json.load(open("sweep_results.json"))
sweep_sorted = sorted(sweep, key=lambda r: r["avg_return_pct"], reverse=True)
top10 = sweep_sorted[:10]
base_case = next(r for r in sweep if r["tp_pct"] == 3.0 and r["sl_pct"] == -15.0 and r["max_hold"] == 15)

vix_series = df["vix_close"].tail(504)  # last ~2 years for context sparkline
vix_points = [[str(d.date()), round(float(v), 2)] for d, v in vix_series.items()]

out = {
    "summary": summary,
    "boot_hist": boot_hist,
    "control_hist": control_hist,
    "real_total_return_pct": summary["total_compounded_return_pct"],
    "equity_points": equity_points,
    "sweep_top10": top10,
    "base_case": base_case,
    "control": control,
    "vix_points": vix_points,
    "current_vix": round(float(df["vix_close"].iloc[-1]), 2),
    "current_uvxy": round(float(df["uvxy_close"].iloc[-1]), 2),
    "data_start": str(df.index[0].date()),
    "data_end": str(df.index[-1].date()),
    "n_signal_days": int((df["vix_close"] < VIX_THRESHOLD).sum()),
}
with open("report_data.json", "w") as f:
    json.dump(out, f)
print("wrote report_data.json")
print("equity points:", len(equity_points), "boot_hist bins:", len(boot_hist["counts"]))

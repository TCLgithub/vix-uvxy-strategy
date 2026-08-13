"""Precompute everything the SVXY HTML report artifact needs."""
import json
import numpy as np
import pandas as pd
from backtest_svxy import load_data, VIX_THRESHOLD, SVXY_LEVERAGE_CHANGE_DATE
from backtest import run_backtest, summarize, bootstrap_mc, random_control_mc

df = load_data()
trades = json.loads(pd.read_csv("trades_svxy.csv").to_json(orient="records"))
summary = summarize(trades, "real")

boot_returns, boot_dd = bootstrap_mc(trades)
control = random_control_mc(df, trades, len(trades))
control_sample = np.array(control.pop("control_total_returns_sample"))

def hist(data, bins, lo, hi):
    counts, edges = np.histogram(data, bins=bins, range=(lo, hi))
    return {"counts": counts.tolist(), "edges": edges.tolist()}

boot_pct = boot_returns * 100
control_pct = control_sample
lo = min(boot_pct.min(), control_pct.min())
hi = max(boot_pct.max(), control_pct.max())
boot_hist = hist(boot_pct, 50, lo, hi)
control_hist = hist(control_pct, 50, lo, hi)

eq = pd.read_csv("equity_curve_svxy.csv")
equity_points = list(zip(eq["trade_num"].tolist(), eq["equity"].tolist()))

n_pre = sum(1 for t in trades if t["entry_date"] < SVXY_LEVERAGE_CHANGE_DATE)

out = {
    "summary": summary,
    "boot_hist": boot_hist,
    "control_hist": control_hist,
    "real_total_return_pct": summary["total_compounded_return_pct"],
    "equity_points": equity_points,
    "leverage_change_trade_idx": n_pre,
    "control": control,
    "trades": trades,
    "current_vix": round(float(df["vix_close"].iloc[-1]), 2),
    "current_svxy": round(float(df["uvxy_close"].iloc[-1]), 2),
    "data_start": str(df.index[0].date()),
    "data_end": str(df.index[-1].date()),
    "vix_threshold": VIX_THRESHOLD,
}
with open("report_data_svxy.json", "w") as f:
    json.dump(out, f)
print("wrote report_data_svxy.json")
print("equity points:", len(equity_points), "boot_hist bins:", len(boot_hist["counts"]))
print("boot p5/p50/p95:", np.percentile(boot_pct, [5, 50, 95]))

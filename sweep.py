"""Parameter sensitivity sweep: is there a TP/SL/hold combo that fixes the
negative expectancy found in the base 3% TP / -15% SL backtest?"""
import json
import numpy as np
from backtest import load_data, run_backtest, summarize

df = load_data()
signal_days = np.where(df["vix_close"].values < 14.0)[0]
signal_days = signal_days[signal_days < len(df) - 1]

results = []
for tp in [0.03, 0.05, 0.08, 0.10, 0.15]:
    for sl in [-0.05, -0.08, -0.10, -0.15, -0.25, None]:
        for max_hold in [5, 10, 15, 25]:
            kwargs = dict(tp=tp, max_hold=max_hold)
            if sl is not None:
                kwargs["sl"] = sl
            else:
                kwargs["sl"] = -0.99  # effectively no stop
            trades = run_backtest(df, signal_days, **kwargs)
            if len(trades) < 20:
                continue
            s = summarize(trades, f"tp{tp}_sl{sl}_hold{max_hold}")
            results.append({
                "tp_pct": tp * 100, "sl_pct": (sl * 100 if sl else None), "max_hold": max_hold,
                "n_trades": s["n_trades"], "win_rate_pct": s["win_rate_pct"],
                "avg_return_pct": s["avg_return_pct"], "total_compounded_return_pct": s["total_compounded_return_pct"],
                "cagr_pct": s["cagr_pct"], "max_drawdown_pct": s["max_drawdown_pct"],
                "profit_factor": s["profit_factor"],
            })

results.sort(key=lambda r: r["avg_return_pct"], reverse=True)
print("Top 15 by average return per trade:")
for r in results[:15]:
    print(json.dumps(r))

print("\nBottom 5 (worst) by average return per trade:")
for r in results[-5:]:
    print(json.dumps(r))

with open("sweep_results.json", "w") as f:
    json.dump(results, f, indent=2)
print(f"\nTotal combos tested: {len(results)}")

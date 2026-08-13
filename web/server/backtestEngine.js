// JS port of backtest.py's run_backtest/summarize, for on-demand interactive
// parameter runs from the Chart page's left panel. No Monte Carlo here (too
// slow for a live UI) -- MC results only exist for the two published defaults
// (report.html / report_svxy.html), computed offline in Python.

let historyCache = { data: null, fetchedAt: 0 };
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000; // 12h -- daily bars don't need to refresh often

async function loadHistory(yf) {
  if (historyCache.data && Date.now() - historyCache.fetchedAt < HISTORY_TTL_MS) {
    return historyCache.data;
  }
  const period1 = Math.floor(new Date('2011-01-01').getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const opts = { period1, period2, interval: '1d' };
  const [vix, uvxy, svxy] = await Promise.all([
    yf.chart('^VIX', opts),
    yf.chart('UVXY', opts),
    yf.chart('SVXY', opts),
  ]);

  const byDate = new Map();
  for (const q of vix.quotes || []) {
    if (q.close == null) continue;
    const key = q.date.toISOString().slice(0, 10);
    byDate.set(key, { date: key, vixClose: q.close });
  }
  function mergeInstrument(quotes, prefix) {
    for (const q of quotes || []) {
      if (q.close == null) continue;
      const key = q.date.toISOString().slice(0, 10);
      const row = byDate.get(key);
      if (!row) continue;
      row[`${prefix}Open`] = q.open;
      row[`${prefix}High`] = q.high;
      row[`${prefix}Low`] = q.low;
      row[`${prefix}Close`] = q.close;
    }
  }
  mergeInstrument(uvxy.quotes, 'uvxy');
  mergeInstrument(svxy.quotes, 'svxy');

  const rows = Array.from(byDate.values())
    .filter((r) => r.vixClose != null && r.uvxyClose != null && r.svxyClose != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  historyCache = { data: rows, fetchedAt: Date.now() };
  return rows;
}

function runBacktest(rows, { instrument, vixMode, threshold, tp, sl, maxHold, cooldown = 1 }) {
  const openKey = `${instrument.toLowerCase()}Open`;
  const highKey = `${instrument.toLowerCase()}High`;
  const lowKey = `${instrument.toLowerCase()}Low`;
  const closeKey = `${instrument.toLowerCase()}Close`;

  const n = rows.length;
  const entrySet = new Set();
  for (let i = 0; i < n - 1; i++) {
    const v = rows[i].vixClose;
    if (vixMode === 'below' ? v < threshold : v > threshold) entrySet.add(i);
  }

  const trades = [];
  let inPosition = false;
  let cooldownUntil = -1;
  let i = 0;
  while (i < n - 1) {
    if (!inPosition && entrySet.has(i) && i >= cooldownUntil) {
      const entryI = i + 1;
      if (entryI >= n) break;
      const entryPrice = rows[entryI][openKey];
      const tpPrice = entryPrice * (1 + tp / 100);
      const slPrice = entryPrice * (1 + sl / 100);
      let exitI = null, exitPrice = null, exitReason = null;
      const lastI = Math.min(entryI + maxHold, n - 1);
      for (let j = entryI; j <= lastI; j++) {
        const hi = rows[j][highKey];
        const lo = rows[j][lowKey];
        const hitSl = lo <= slPrice;
        const hitTp = hi >= tpPrice;
        if (hitSl) { exitI = j; exitPrice = slPrice; exitReason = 'stop_loss'; break; }
        if (hitTp) { exitI = j; exitPrice = tpPrice; exitReason = 'take_profit'; break; }
      }
      if (exitI == null) {
        exitI = lastI;
        exitPrice = rows[exitI][closeKey];
        exitReason = 'max_hold';
      }
      const ret = exitPrice / entryPrice - 1;
      trades.push({
        signalDate: rows[i].date,
        entryDate: rows[entryI].date,
        exitDate: rows[exitI].date,
        entryPrice, exitPrice,
        returnPct: ret * 100,
        holdDays: exitI - entryI,
        exitReason,
      });
      inPosition = false;
      cooldownUntil = exitI + 1 + cooldown;
      i = exitI + 1;
      continue;
    }
    i++;
  }
  return trades;
}

function summarize(trades) {
  if (!trades.length) return { n_trades: 0 };
  const rets = trades.map((t) => t.returnPct / 100);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  let equity = 1;
  const equityPoints = [];
  let peak = 1, maxDd = 0;
  rets.forEach((r, idx) => {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity / peak - 1);
    equityPoints.push([idx + 1, equity]);
  });
  const totalReturn = equity - 1;
  const winRate = wins.length / rets.length;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const profitFactor = grossLoss !== 0 ? grossWin / grossLoss : null;
  const avgReturn = rets.reduce((a, b) => a + b, 0) / rets.length;
  const holdDays = trades.map((t) => t.holdDays);
  const avgHold = holdDays.reduce((a, b) => a + b, 0) / holdDays.length;
  const years = Math.max(
    (new Date(trades[trades.length - 1].exitDate) - new Date(trades[0].signalDate)) / (365.25 * 86400000),
    0.01
  );
  const cagr = Math.pow(equity, 1 / years) - 1;
  const exitCounts = {};
  for (const t of trades) exitCounts[t.exitReason] = (exitCounts[t.exitReason] || 0) + 1;
  return {
    n_trades: trades.length,
    win_rate_pct: round(winRate * 100, 2),
    avg_return_pct: round(avgReturn * 100, 3),
    avg_win_pct: wins.length ? round((wins.reduce((a, b) => a + b, 0) / wins.length) * 100, 3) : null,
    avg_loss_pct: losses.length ? round((losses.reduce((a, b) => a + b, 0) / losses.length) * 100, 3) : null,
    profit_factor: profitFactor != null ? round(profitFactor, 3) : null,
    total_compounded_return_pct: round(totalReturn * 100, 2),
    cagr_pct: round(cagr * 100, 2),
    max_drawdown_pct: round(maxDd * 100, 2),
    avg_hold_days: round(avgHold, 2),
    exit_reason_counts: exitCounts,
    period_start: trades[0].signalDate,
    period_end: trades[trades.length - 1].exitDate,
  };
}

function round(n, d) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

export { loadHistory, runBacktest, summarize };

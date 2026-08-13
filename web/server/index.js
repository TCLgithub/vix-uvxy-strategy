import express from 'express';
import cors from 'cors';
import YahooFinance from 'yahoo-finance2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHistory, runBacktest, summarize } from './backtestEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // VIX - UVXY/
const JOURNAL_PATH = path.join(__dirname, 'journal.json');

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json());

const VIX_LOW_THRESHOLD = 14.0;
const VIX_HIGH_THRESHOLD = 25.0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(fn, attempts = 3, delayMs = 800) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs * (i + 1)); // backoff: 800ms, 1600ms
    }
  }
  throw lastErr;
}

// Yahoo's shared/datacenter-IP rate limiting (esp. on free hosting tiers) means
// live fetches occasionally 429. We retry with backoff, and if that still fails,
// fall back to the last successfully fetched data rather than erroring the UI.
// Persisted to disk too, so a fresh deploy that immediately hits a rate limit
// (no in-memory history yet) still has *something* to fall back to.
const LAST_QUOTES_PATH = path.join(__dirname, 'last_quotes.json');
let quoteCache = { data: null, fetchedAt: 0 };
let lastGoodQuotes = (() => {
  try {
    if (fs.existsSync(LAST_QUOTES_PATH)) return JSON.parse(fs.readFileSync(LAST_QUOTES_PATH, 'utf-8'));
  } catch { /* ignore -- fall through to null */ }
  return null;
})();
const QUOTE_TTL_MS = 30 * 1000;

async function getQuotes() {
  if (quoteCache.data && Date.now() - quoteCache.fetchedAt < QUOTE_TTL_MS) {
    return quoteCache.data;
  }
  try {
    const [vix, uvxy, svxy] = await withRetry(() => Promise.all([
      yf.quote('^VIX'),
      yf.quote('UVXY'),
      yf.quote('SVXY'),
    ]));
    // Yahoo's regularMarketChange/-Percent occasionally glitches (seen: equal to
    // -previousClose, as if price were treated as 0) while price/previousClose stay
    // correct. Recompute from those two directly instead of trusting the precomputed field.
    function withChange(q) {
      const price = q.regularMarketPrice;
      const prevClose = q.regularMarketPreviousClose;
      const change = prevClose ? price - prevClose : q.regularMarketChange;
      const changePct = prevClose ? (change / prevClose) * 100 : q.regularMarketChangePercent;
      return { price, change, changePct, time: q.regularMarketTime };
    }
    const data = {
      vix: withChange(vix),
      uvxy: withChange(uvxy),
      svxy: withChange(svxy),
      signalActive: vix.regularMarketPrice < VIX_LOW_THRESHOLD,
      threshold: VIX_LOW_THRESHOLD,
      signalHighActive: vix.regularMarketPrice > VIX_HIGH_THRESHOLD,
      thresholdHigh: VIX_HIGH_THRESHOLD,
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
    quoteCache = { data, fetchedAt: Date.now() };
    lastGoodQuotes = data;
    fs.writeFile(LAST_QUOTES_PATH, JSON.stringify(data), () => {}); // best-effort, don't block the response
    return data;
  } catch (err) {
    if (lastGoodQuotes) {
      return { ...lastGoodQuotes, stale: true };
    }
    throw err;
  }
}

app.get('/api/quotes', async (req, res) => {
  try {
    res.json(await getQuotes());
  } catch (err) {
    res.status(502).json({ error: 'quote_fetch_failed', message: err.message });
  }
});

const intradayCache = new Map(); // symbol -> { points, fetchedAt }
const INTRADAY_TTL_MS = 5 * 60 * 1000;

app.get('/api/intraday/:symbol', async (req, res) => {
  const symbol = req.params.symbol === 'VIX' ? '^VIX' : req.params.symbol;
  const cached = intradayCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < INTRADAY_TTL_MS) {
    return res.json({ symbol, points: cached.points, stale: false });
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const chart = await withRetry(() => yf.chart(symbol, {
      period1: now - 6 * 86400,
      period2: now,
      interval: '1d',
    }));
    const points = (chart.quotes || [])
      .filter((q) => q.close != null)
      .map((q) => ({ date: q.date, close: q.close, high: q.high, low: q.low, open: q.open }));
    intradayCache.set(symbol, { points, fetchedAt: Date.now() });
    res.json({ symbol, points, stale: false });
  } catch (err) {
    if (cached) {
      return res.json({ symbol, points: cached.points, stale: true });
    }
    res.status(502).json({ error: 'chart_fetch_failed', message: err.message });
  }
});

function readJson(file, fallback) {
  const p = path.join(PROJECT_ROOT, file);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

app.get('/api/backtest/results', (req, res) => {
  res.json(readJson('results.json', null));
});

app.get('/api/backtest/report-data', (req, res) => {
  res.json(readJson('report_data.json', null));
});

app.get('/api/backtest/sweep', (req, res) => {
  res.json(readJson('sweep_results.json', []));
});

app.get('/api/backtest/report-data-svxy', (req, res) => {
  res.json(readJson('report_data_svxy.json', null));
});

app.get('/api/backtest/results-svxy', (req, res) => {
  res.json(readJson('results_svxy.json', null));
});

// Interactive parameter runs from the Chart page's left panel. No Monte Carlo
// (too slow for live UI) -- just the backtest + equity curve, computed on
// demand against cached full-history VIX/UVXY/SVXY daily bars.
app.post('/api/backtest/run', async (req, res) => {
  try {
    const instrument = req.body.instrument === 'SVXY' ? 'SVXY' : 'UVXY';
    const vixMode = req.body.vixMode === 'above' ? 'above' : 'below';
    const threshold = clampNum(req.body.threshold, 5, 60, instrument === 'SVXY' ? 25 : 14);
    const tp = clampNum(req.body.tp, 0.5, 50, instrument === 'SVXY' ? 10 : 3);
    const sl = -clampNum(Math.abs(req.body.sl), 0.5, 50, instrument === 'SVXY' ? 20 : 15);
    const maxHold = Math.round(clampNum(req.body.maxHold, 1, 60, instrument === 'SVXY' ? 20 : 15));

    const rows = await withRetry(() => loadHistory(yf));
    const trades = runBacktest(rows, { instrument, vixMode, threshold, tp, sl, maxHold, cooldown: 1 });
    if (trades.length < 5) {
      return res.status(200).json({
        config: { instrument, vixMode, threshold, tp, sl, maxHold },
        summary: { n_trades: trades.length },
        equity_points: [],
        warning: 'Too few trades at these settings to be meaningful (need at least 5).',
      });
    }
    const summary = summarize(trades);
    const equityPoints = [];
    let equity = 1;
    trades.forEach((t, idx) => {
      equity *= 1 + t.returnPct / 100;
      equityPoints.push([idx + 1, equity]);
    });
    res.json({
      config: { instrument, vixMode, threshold, tp, sl, maxHold },
      summary,
      equity_points: equityPoints,
    });
  } catch (err) {
    res.status(502).json({ error: 'backtest_run_failed', message: err.message });
  }
});

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function serveStaticReport(filename) {
  return (req, res) => {
    const reportPath = path.join(PROJECT_ROOT, filename);
    if (!fs.existsSync(reportPath)) return res.status(404).send('Report not found');
    res.sendFile(reportPath);
  };
}

app.get('/report', serveStaticReport('report.html'));
app.get('/report-svxy', serveStaticReport('report_svxy.html'));

// --- trade journal (manual entries; no broker connection) ---
function readJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return [];
  return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf-8'));
}
function writeJournal(entries) {
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(entries, null, 2));
}

app.get('/api/journal', (req, res) => {
  res.json(readJournal());
});

app.post('/api/journal', (req, res) => {
  const { entryPrice, entryDate, targetPct, stopPct, notes, instrument } = req.body;
  if (!entryPrice || !entryDate) {
    return res.status(400).json({ error: 'entryPrice and entryDate are required' });
  }
  const inst = instrument === 'SVXY' ? 'SVXY' : 'UVXY';
  const entries = readJournal();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    instrument: inst,
    entryPrice: Number(entryPrice),
    entryDate,
    targetPct: targetPct != null ? Number(targetPct) : (inst === 'SVXY' ? 10 : 3),
    stopPct: stopPct != null ? Number(stopPct) : (inst === 'SVXY' ? -20 : -15),
    notes: notes || '',
    status: 'open',
    exitPrice: null,
    exitDate: null,
    createdAt: new Date().toISOString(),
  };
  entries.unshift(entry);
  writeJournal(entries);
  res.status(201).json(entry);
});

app.patch('/api/journal/:id', (req, res) => {
  const entries = readJournal();
  const idx = entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const { exitPrice, exitDate, status, notes } = req.body;
  if (exitPrice != null) entries[idx].exitPrice = Number(exitPrice);
  if (exitDate != null) entries[idx].exitDate = exitDate;
  if (status != null) entries[idx].status = status;
  if (notes != null) entries[idx].notes = notes;
  writeJournal(entries);
  res.json(entries[idx]);
});

app.delete('/api/journal/:id', (req, res) => {
  const entries = readJournal().filter((e) => e.id !== req.params.id);
  writeJournal(entries);
  res.status(204).end();
});

// In production (Render), this server also serves the built frontend —
// no separate Vite process, so there's no dev-only PORT collision to avoid.
if (IS_PROD) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.use((req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not_found' });
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Render assigns PORT dynamically; local dev uses SERVER_PORT to avoid
// colliding with the preview tool's own PORT env var (which targets Vite).
const PORT = IS_PROD ? (process.env.PORT || 10000) : (process.env.SERVER_PORT || 3011);
app.listen(PORT, () => {
  console.log(`VIX/UVXY server listening on http://localhost:${PORT}`);
});

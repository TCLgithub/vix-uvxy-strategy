import express from 'express';
import cors from 'cors';
import YahooFinance from 'yahoo-finance2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // VIX - UVXY/
const JOURNAL_PATH = path.join(__dirname, 'journal.json');

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json());

const VIX_THRESHOLD = 14.0;

let quoteCache = { data: null, fetchedAt: 0 };
const QUOTE_TTL_MS = 30 * 1000;

async function getQuotes() {
  if (quoteCache.data && Date.now() - quoteCache.fetchedAt < QUOTE_TTL_MS) {
    return quoteCache.data;
  }
  const [vix, uvxy] = await Promise.all([
    yf.quote('^VIX'),
    yf.quote('UVXY'),
  ]);
  const data = {
    vix: {
      price: vix.regularMarketPrice,
      change: vix.regularMarketChange,
      changePct: vix.regularMarketChangePercent,
      time: vix.regularMarketTime,
    },
    uvxy: {
      price: uvxy.regularMarketPrice,
      change: uvxy.regularMarketChange,
      changePct: uvxy.regularMarketChangePercent,
      time: uvxy.regularMarketTime,
    },
    signalActive: vix.regularMarketPrice < VIX_THRESHOLD,
    threshold: VIX_THRESHOLD,
    fetchedAt: new Date().toISOString(),
  };
  quoteCache = { data, fetchedAt: Date.now() };
  return data;
}

app.get('/api/quotes', async (req, res) => {
  try {
    res.json(await getQuotes());
  } catch (err) {
    res.status(502).json({ error: 'quote_fetch_failed', message: err.message });
  }
});

app.get('/api/intraday/:symbol', async (req, res) => {
  const symbol = req.params.symbol === 'VIX' ? '^VIX' : req.params.symbol;
  try {
    const now = Math.floor(Date.now() / 1000);
    const chart = await yf.chart(symbol, {
      period1: now - 6 * 86400,
      period2: now,
      interval: '1d',
    });
    const points = (chart.quotes || [])
      .filter((q) => q.close != null)
      .map((q) => ({ date: q.date, close: q.close, high: q.high, low: q.low, open: q.open }));
    res.json({ symbol, points });
  } catch (err) {
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
  const { entryPrice, entryDate, targetPct, stopPct, notes } = req.body;
  if (!entryPrice || !entryDate) {
    return res.status(400).json({ error: 'entryPrice and entryDate are required' });
  }
  const entries = readJournal();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    entryPrice: Number(entryPrice),
    entryDate,
    targetPct: targetPct != null ? Number(targetPct) : 3,
    stopPct: stopPct != null ? Number(stopPct) : -15,
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

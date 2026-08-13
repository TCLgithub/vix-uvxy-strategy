import React, { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface Quotes {
  vix: { price: number; change: number; changePct: number; time: string };
  uvxy: { price: number; change: number; changePct: number; time: string };
  signalActive: boolean;
  threshold: number;
  fetchedAt: string;
}

interface IntradayPoint { date: string; close: number; high: number; low: number; open: number }

interface ReportData {
  summary: {
    n_trades: number;
    win_rate_pct: number;
    avg_return_pct: number;
    total_compounded_return_pct: number;
    max_drawdown_pct: number;
    cagr_pct: number;
  };
  equity_points: [number, number][];
  control: { real_beats_random_pct_of_time_by_return: number };
  current_vix: number;
  current_uvxy: number;
}

function fmt(n: number | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

export default function ChartPage() {
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [vixHist, setVixHist] = useState<IntradayPoint[]>([]);
  const [uvxyHist, setUvxyHist] = useState<IntradayPoint[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadQuotes() {
      try {
        const res = await fetch('/api/quotes');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (!cancelled) { setQuotes(data); setQuoteErr(null); }
      } catch (e: any) {
        if (!cancelled) setQuoteErr(e.message || 'failed to load quotes');
      }
    }
    loadQuotes();
    const id = setInterval(loadQuotes, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    fetch('/api/intraday/VIX').then((r) => r.json()).then((d) => setVixHist(d.points || []));
    fetch('/api/intraday/UVXY').then((r) => r.json()).then((d) => setUvxyHist(d.points || []));
    fetch('/api/backtest/report-data').then((r) => r.json()).then(setReport).catch(() => {});
  }, []);

  const signalActive = quotes?.signalActive ?? false;
  const distance = quotes ? (quotes.vix.price - quotes.threshold) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <SignalBanner active={signalActive} vix={quotes?.vix.price} distance={distance} err={quoteErr} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <QuoteCard label="VIX" price={quotes?.vix.price} change={quotes?.vix.change} changePct={quotes?.vix.changePct} points={vixHist} threshold={14} />
        <QuoteCard label="UVXY" price={quotes?.uvxy.price} change={quotes?.uvxy.change} changePct={quotes?.uvxy.changePct} points={uvxyHist} prefix="$" />
      </div>

      {report && (
        <section style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.25rem 1.5rem' }}>
          <h2 style={{ fontSize: 16, margin: '0 0 0.9rem', fontWeight: 600 }}>Backtest verdict (3% TP / -15% SL / 15d hold, 2011&ndash;2026)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: '1.1rem' }}>
            <Stat label="Trades" value={String(report.summary.n_trades)} />
            <Stat label="Win rate" value={`${fmt(report.summary.win_rate_pct, 1)}%`} tone="win" />
            <Stat label="Avg / trade" value={`${fmt(report.summary.avg_return_pct, 2)}%`} tone={report.summary.avg_return_pct < 0 ? 'loss' : 'win'} />
            <Stat label="Total return" value={`${fmt(report.summary.total_compounded_return_pct, 1)}%`} tone={report.summary.total_compounded_return_pct < 0 ? 'loss' : 'win'} />
            <Stat label="Max drawdown" value={`${fmt(report.summary.max_drawdown_pct, 1)}%`} tone="loss" />
            <Stat label="Beats random entry" value={`${fmt(report.control.real_beats_random_pct_of_time_by_return, 0)}%`} />
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={report.equity_points.map(([n, v]) => ({ trade: n, equity: v }))}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e8a33d" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#e8a33d" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="trade" hide />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <ReferenceLine y={1} stroke="#544a2c" strokeDasharray="3 3" />
              <Tooltip contentStyle={{ background: '#201c13', border: '0.5px solid #3c341f', borderRadius: 8, fontSize: 12 }} labelFormatter={(v) => `Trade ${v}`} formatter={(v: number) => [`${v.toFixed(2)}x`, 'Equity']} />
              <Area type="monotone" dataKey="equity" stroke="#e8a33d" fill="url(#eq)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>
            Original 3%-take-profit rule loses money historically (see README.md / the full verification report for methodology, Monte Carlo results, and a better-performing parameter set found in the sweep).
          </p>
        </section>
      )}
    </div>
  );
}

function SignalBanner({ active, vix, distance, err }: { active: boolean; vix?: number; distance: number | null; err: string | null }) {
  if (err) {
    return (
      <div style={{ background: 'var(--loss-bg)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '0.9rem 1.1rem', color: 'var(--loss)', fontSize: 13.5 }}>
        Couldn't load live quotes ({err}). Retrying every 30s.
      </div>
    );
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
      background: active ? 'var(--accent-bg)' : 'var(--surface)',
      border: `0.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 12, padding: '1rem 1.25rem',
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%',
        background: active ? 'var(--accent)' : 'var(--text-muted)',
        boxShadow: active ? '0 0 0 4px rgba(232,163,61,0.25)' : 'none',
      }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {active ? 'Signal active — VIX below 14.00' : 'Watching — VIX above 14.00 trigger'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }} className="num">
          VIX {fmt(vix)}
          {distance != null && (
            <span> &middot; {distance <= 0 ? `${fmt(Math.abs(distance))} below trigger` : `${fmt(distance)} above trigger`}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function QuoteCard({ label, price, change, changePct, points, prefix = '', threshold }: {
  label: string; price?: number; change?: number; changePct?: number; points: IntradayPoint[]; prefix?: string; threshold?: number;
}) {
  const up = (change ?? 0) >= 0;
  return (
    <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.1rem 1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        {change != null && (
          <span className="num" style={{ fontSize: 12.5, color: up ? 'var(--win)' : 'var(--loss)' }}>
            {up ? '+' : ''}{fmt(change)} ({up ? '+' : ''}{fmt(changePct)}%)
          </span>
        )}
      </div>
      <div className="num" style={{ fontSize: 30, fontWeight: 700, margin: '0.3rem 0 0.6rem' }}>
        {prefix}{fmt(price)}
      </div>
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={points}>
          {threshold != null && <ReferenceLine y={threshold} stroke="#e8a33d" strokeDasharray="3 3" />}
          <Line type="monotone" dataKey="close" stroke={up ? '#6ec090' : '#e2685c'} strokeWidth={2} dot={false} />
          <YAxis hide domain={['dataMin', 'dataMax']} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'win' | 'loss' }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '0.7rem 0.85rem' }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 17, fontWeight: 600, color: tone === 'win' ? 'var(--win)' : tone === 'loss' ? 'var(--loss)' : 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

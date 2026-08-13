import React, { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface Quotes {
  vix: { price: number; change: number; changePct: number; time: string };
  uvxy: { price: number; change: number; changePct: number; time: string };
  svxy: { price: number; change: number; changePct: number; time: string };
  signalActive: boolean;
  threshold: number;
  signalHighActive: boolean;
  thresholdHigh: number;
  fetchedAt: string;
  stale?: boolean;
}

interface IntradayPoint { date: string; close: number; high: number; low: number; open: number }

interface Summary {
  n_trades: number;
  win_rate_pct: number;
  avg_return_pct: number;
  total_compounded_return_pct: number;
  max_drawdown_pct: number;
  cagr_pct: number;
}

interface ReportData {
  summary: Summary;
  equity_points: [number, number][];
  control: { real_beats_random_pct_of_time_by_return: number };
  current_vix: number;
  current_uvxy: number;
}

type Strategy = 'uvxy' | 'svxy';

const STRATEGY_META: Record<Strategy, { title: string; endpoint: string; reportUrl: string; caption: string; color: string }> = {
  uvxy: {
    title: 'UVXY momentum (3% TP / -15% SL / 15d hold, 2011–2026)',
    endpoint: '/api/backtest/report-data',
    reportUrl: '/report',
    caption: 'Original 3%-take-profit rule loses money historically.',
    color: '#e8a33d',
  },
  svxy: {
    title: 'SVXY mean-reversion (10% TP / -20% SL / 20d hold, 2011–2026)',
    endpoint: '/api/backtest/report-data-svxy',
    reportUrl: '/report-svxy',
    caption: 'Buys the VIX>25 dip in vol via SVXY. Stronger historically, but lightly tested against tail risk.',
    color: '#6ec090',
  },
};

function fmt(n: number | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

export default function ChartPage() {
  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [vixHist, setVixHist] = useState<IntradayPoint[]>([]);
  const [uvxyHist, setUvxyHist] = useState<IntradayPoint[]>([]);
  const [svxyHist, setSvxyHist] = useState<IntradayPoint[]>([]);
  const [strategy, setStrategy] = useState<Strategy>('uvxy');
  const [reports, setReports] = useState<Record<Strategy, ReportData | null>>({ uvxy: null, svxy: null });

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
    fetch('/api/intraday/SVXY').then((r) => r.json()).then((d) => setSvxyHist(d.points || []));
    fetch('/api/backtest/report-data').then((r) => r.json()).then((d) => setReports((r) => ({ ...r, uvxy: d }))).catch(() => {});
    fetch('/api/backtest/report-data-svxy').then((r) => r.json()).then((d) => setReports((r) => ({ ...r, svxy: d }))).catch(() => {});
  }, []);

  const distanceLow = quotes ? (quotes.vix.price - quotes.threshold) : null;
  const distanceHigh = quotes ? (quotes.thresholdHigh - quotes.vix.price) : null;
  const report = reports[strategy];
  const meta = STRATEGY_META[strategy];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {quoteErr ? (
        <div style={{ background: 'var(--loss-bg)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '0.9rem 1.1rem', color: 'var(--loss)', fontSize: 13.5 }}>
          Couldn't load live quotes ({quoteErr}). Retrying every 30s.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <SignalBanner
            active={quotes?.signalActive ?? false}
            label={quotes?.signalActive ? 'Signal active — VIX below 14.00' : 'Watching — VIX above 14.00 trigger'}
            sub={quotes ? `VIX ${fmt(quotes.vix.price)} · ${distanceLow! <= 0 ? `${fmt(Math.abs(distanceLow!))} below trigger` : `${fmt(distanceLow!)} above trigger`}` : undefined}
            stale={quotes?.stale}
            accent="#e8a33d"
          />
          <SignalBanner
            active={quotes?.signalHighActive ?? false}
            label={quotes?.signalHighActive ? 'Signal active — VIX above 25.00' : 'Watching — VIX below 25.00 trigger'}
            sub={quotes ? `VIX ${fmt(quotes.vix.price)} · ${distanceHigh! <= 0 ? `${fmt(Math.abs(distanceHigh!))} above trigger` : `${fmt(distanceHigh!)} below trigger`}` : undefined}
            stale={quotes?.stale}
            accent="#6ec090"
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <QuoteCard label="VIX" price={quotes?.vix.price} change={quotes?.vix.change} changePct={quotes?.vix.changePct} points={vixHist} thresholds={[14, 25]} />
        <QuoteCard label="UVXY" price={quotes?.uvxy.price} change={quotes?.uvxy.change} changePct={quotes?.uvxy.changePct} points={uvxyHist} prefix="$" />
        <QuoteCard label="SVXY" price={quotes?.svxy.price} change={quotes?.svxy.change} changePct={quotes?.svxy.changePct} points={svxyHist} prefix="$" />
      </div>

      <section style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.9rem' }}>
          <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>Backtest verdict</h2>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 4 }}>
            <StrategyButton active={strategy === 'uvxy'} onClick={() => setStrategy('uvxy')}>UVXY momentum</StrategyButton>
            <StrategyButton active={strategy === 'svxy'} onClick={() => setStrategy('svxy')}>SVXY reversion</StrategyButton>
          </div>
        </div>

        {report ? (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 0.9rem' }}>{meta.title}</p>
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
                  <linearGradient id={`eq-${strategy}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={meta.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={meta.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="trade" hide />
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <ReferenceLine y={1} stroke="#544a2c" strokeDasharray="3 3" />
                <Tooltip contentStyle={{ background: '#201c13', border: '0.5px solid #3c341f', borderRadius: 8, fontSize: 12 }} labelFormatter={(v) => `Trade ${v}`} formatter={(v: number) => [`${v.toFixed(2)}x`, 'Equity']} />
                <Area type="monotone" dataKey="equity" stroke={meta.color} fill={`url(#eq-${strategy})`} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>
              {meta.caption}{' '}
              <a href={meta.reportUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                Read the full verification report &rarr;
              </a>
            </p>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Loading backtest data&hellip;</p>
        )}
      </section>
    </div>
  );
}

function SignalBanner({ active, label, sub, stale, accent }: { active: boolean; label: string; sub?: string; stale?: boolean; accent: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.85rem',
      background: active ? `${accent}22` : 'var(--surface)',
      border: `0.5px solid ${active ? accent : 'var(--border)'}`,
      borderRadius: 12, padding: '1rem 1.25rem',
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
        background: active ? accent : 'var(--text-muted)',
        boxShadow: active ? `0 0 0 4px ${accent}33` : 'none',
      }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{label}</div>
        {sub && (
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }} className="num">
            {sub}
            {stale && <span style={{ color: 'var(--text-muted)' }}> &middot; feed briefly rate-limited, showing last good price</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function QuoteCard({ label, price, change, changePct, points, prefix = '', thresholds }: {
  label: string; price?: number; change?: number; changePct?: number; points: IntradayPoint[]; prefix?: string; thresholds?: number[];
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
          {thresholds?.map((t) => <ReferenceLine key={t} y={t} stroke="#e8a33d" strokeDasharray="3 3" />)}
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

function StrategyButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.4rem 0.9rem',
        borderRadius: 6,
        border: 'none',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: 600,
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

import React, { useEffect, useRef, useState } from 'react';
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
  win_rate_pct?: number;
  avg_return_pct?: number;
  total_compounded_return_pct?: number;
  max_drawdown_pct?: number;
  cagr_pct?: number;
}

interface ReportData {
  summary: Summary;
  equity_points: [number, number][];
  control: { real_beats_random_pct_of_time_by_return: number };
}

type Instrument = 'UVXY' | 'SVXY';
type VixMode = 'below' | 'above';

interface Params {
  instrument: Instrument;
  vixMode: VixMode;
  threshold: number;
  tp: number;
  sl: number; // negative
  maxHold: number;
}

const DEFAULTS: Record<Instrument, Params> = {
  UVXY: { instrument: 'UVXY', vixMode: 'below', threshold: 14, tp: 3, sl: -15, maxHold: 15 },
  SVXY: { instrument: 'SVXY', vixMode: 'above', threshold: 25, tp: 10, sl: -20, maxHold: 20 },
};

const REPORT_URL: Record<Instrument, string> = { UVXY: '/report', SVXY: '/report-svxy' };
const COLOR: Record<Instrument, string> = { UVXY: '#e8a33d', SVXY: '#6ec090' };

function sameParams(a: Params, b: Params) {
  return a.instrument === b.instrument && a.vixMode === b.vixMode && a.threshold === b.threshold
    && a.tp === b.tp && a.sl === b.sl && a.maxHold === b.maxHold;
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
  const [svxyHist, setSvxyHist] = useState<IntradayPoint[]>([]);
  const [reports, setReports] = useState<Record<Instrument, ReportData | null>>({ UVXY: null, SVXY: null });

  const [collapsed, setCollapsed] = useState(false);
  const [params, setParams] = useState<Params>(DEFAULTS.UVXY);
  const [runResult, setRunResult] = useState<{ summary: Summary; equity_points: [number, number][]; warning?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    fetch('/api/backtest/report-data').then((r) => r.json()).then((d) => setReports((r) => ({ ...r, UVXY: d }))).catch(() => {});
    fetch('/api/backtest/report-data-svxy').then((r) => r.json()).then((d) => setReports((r) => ({ ...r, SVXY: d }))).catch(() => {});
  }, []);

  const isPublishedDefault = sameParams(params, DEFAULTS[params.instrument]);

  useEffect(() => {
    if (isPublishedDefault) { setRunResult(null); return; } // use the published report data instead
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setRunning(true);
      try {
        const res = await fetch('/api/backtest/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const data = await res.json();
        setRunResult(data);
      } catch {
        setRunResult(null);
      } finally {
        setRunning(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [params, isPublishedDefault]);

  function selectInstrument(instrument: Instrument) {
    setParams(DEFAULTS[instrument]);
  }

  const distanceLow = quotes ? (quotes.vix.price - quotes.threshold) : null;
  const distanceHigh = quotes ? (quotes.thresholdHigh - quotes.vix.price) : null;

  const published = reports[params.instrument];
  const summary: Summary | undefined = isPublishedDefault ? published?.summary : runResult?.summary;
  const equityPoints: [number, number][] = isPublishedDefault ? (published?.equity_points ?? []) : (runResult?.equity_points ?? []);
  const beatsRandom = isPublishedDefault ? published?.control.real_beats_random_pct_of_time_by_return : undefined;
  const color = COLOR[params.instrument];

  return (
    <div className="app-layout">
      <ParamPanel collapsed={collapsed} setCollapsed={setCollapsed} params={params} setParams={setParams} onSelectInstrument={selectInstrument} />

      <div className="app-main" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>Backtest verdict</h2>
            {running && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>running…</span>}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 0.9rem' }}>
            {params.instrument} &middot; VIX {params.vixMode === 'below' ? '<' : '>'} {params.threshold} &middot; {params.tp}% TP / {params.sl}% SL / {params.maxHold}d hold
          </p>

          {summary && summary.n_trades >= 5 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: '1.1rem' }}>
                <Stat label="Trades" value={String(summary.n_trades)} />
                <Stat label="Win rate" value={`${fmt(summary.win_rate_pct, 1)}%`} tone="win" />
                <Stat label="Avg / trade" value={`${fmt(summary.avg_return_pct, 2)}%`} tone={(summary.avg_return_pct ?? 0) < 0 ? 'loss' : 'win'} />
                <Stat label="Total return" value={`${fmt(summary.total_compounded_return_pct, 1)}%`} tone={(summary.total_compounded_return_pct ?? 0) < 0 ? 'loss' : 'win'} />
                <Stat label="Max drawdown" value={`${fmt(summary.max_drawdown_pct, 1)}%`} tone="loss" />
                {beatsRandom != null && <Stat label="Beats random entry" value={`${fmt(beatsRandom, 0)}%`} />}
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={equityPoints.map(([n, v]) => ({ trade: n, equity: v }))}>
                  <defs>
                    <linearGradient id="eq-live" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="trade" hide />
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <ReferenceLine y={1} stroke="#544a2c" strokeDasharray="3 3" />
                  <Tooltip contentStyle={{ background: '#201c13', border: '0.5px solid #3c341f', borderRadius: 8, fontSize: 12 }} labelFormatter={(v) => `Trade ${v}`} formatter={(v: number) => [`${v.toFixed(2)}x`, 'Equity']} />
                  <Area type="monotone" dataKey="equity" stroke={color} fill="url(#eq-live)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>
                {isPublishedDefault ? (
                  <>
                    Published default, verified with Monte Carlo.{' '}
                    <a href={REPORT_URL[params.instrument]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      Read the full verification report &rarr;
                    </a>
                  </>
                ) : (
                  <>Custom parameters — backtest only, no Monte Carlo run for this combination. Compare against the {' '}
                    <a href={REPORT_URL[params.instrument]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      published {params.instrument} report
                    </a>{' '}(reset the panel to match its settings exactly).
                  </>
                )}
              </p>
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>
              {running ? 'Running backtest…' : runResult?.warning || 'Loading backtest data…'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function ParamPanel({ collapsed, setCollapsed, params, setParams, onSelectInstrument }: {
  collapsed: boolean; setCollapsed: (c: boolean) => void; params: Params; setParams: (p: Params) => void; onSelectInstrument: (i: Instrument) => void;
}) {
  if (collapsed) {
    return (
      <div className="app-sidebar collapsed">
        <button onClick={() => setCollapsed(false)} title="Show parameters" style={{
          background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 8,
          padding: '0.5rem 0.6rem', color: 'var(--text-secondary)',
        }}>&raquo;</button>
      </div>
    );
  }
  const isDefault = sameParams(params, DEFAULTS[params.instrument]);
  return (
    <aside className="app-sidebar">
      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.1rem 1.1rem', position: 'sticky', top: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
          <h3 style={{ fontSize: 13, margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>Parameters</h3>
          <button onClick={() => setCollapsed(true)} title="Hide" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 16, padding: 0 }}>&laquo;</button>
        </div>

        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 4, marginBottom: '1.1rem' }}>
          <SmallToggle active={params.instrument === 'UVXY'} onClick={() => onSelectInstrument('UVXY')}>UVXY</SmallToggle>
          <SmallToggle active={params.instrument === 'SVXY'} onClick={() => onSelectInstrument('SVXY')}>SVXY</SmallToggle>
        </div>

        <SliderField
          label="VIX condition"
          valueLabel={`${params.vixMode === 'below' ? '<' : '>'} ${params.threshold}`}
        >
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <SmallToggle active={params.vixMode === 'below'} onClick={() => setParams({ ...params, vixMode: 'below' })}>Below</SmallToggle>
            <SmallToggle active={params.vixMode === 'above'} onClick={() => setParams({ ...params, vixMode: 'above' })}>Above</SmallToggle>
          </div>
          <input type="range" min={8} max={40} step={0.5} value={params.threshold}
            onChange={(e) => setParams({ ...params, threshold: Number(e.target.value) })} style={{ width: '100%' }} />
        </SliderField>

        <SliderField label="Take profit" valueLabel={`+${params.tp}%`}>
          <input type="range" min={1} max={30} step={0.5} value={params.tp}
            onChange={(e) => setParams({ ...params, tp: Number(e.target.value) })} style={{ width: '100%' }} />
        </SliderField>

        <SliderField label="Stop loss" valueLabel={`${params.sl}%`}>
          <input type="range" min={-40} max={-1} step={0.5} value={params.sl}
            onChange={(e) => setParams({ ...params, sl: Number(e.target.value) })} style={{ width: '100%' }} />
        </SliderField>

        <SliderField label="Max hold" valueLabel={`${params.maxHold}d`}>
          <input type="range" min={1} max={40} step={1} value={params.maxHold}
            onChange={(e) => setParams({ ...params, maxHold: Number(e.target.value) })} style={{ width: '100%' }} />
        </SliderField>

        <button
          onClick={() => setParams(DEFAULTS[params.instrument])}
          disabled={isDefault}
          style={{
            width: '100%', marginTop: '0.5rem', padding: '0.5rem', borderRadius: 7,
            border: '0.5px solid var(--border)', background: isDefault ? 'transparent' : 'var(--accent-bg)',
            color: isDefault ? 'var(--text-muted)' : 'var(--accent)', fontWeight: 600, fontSize: 13,
          }}
        >
          {isDefault ? 'Using published default' : 'Reset to published default'}
        </button>
      </div>
    </aside>
  );
}

function SliderField({ label, valueLabel, children }: { label: string; valueLabel: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
        <span>{label}</span>
        <span className="num" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{valueLabel}</span>
      </div>
      {children}
    </div>
  );
}

function SmallToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '0.35rem 0.5rem', borderRadius: 6, border: 'none',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: 600, fontSize: 12.5,
      }}
    >
      {children}
    </button>
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

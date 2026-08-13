import React, { useEffect, useState } from 'react';

type Instrument = 'UVXY' | 'SVXY';

interface JournalEntry {
  id: string;
  instrument?: Instrument;
  entryPrice: number;
  entryDate: string;
  targetPct: number;
  stopPct: number;
  notes: string;
  status: 'open' | 'closed';
  exitPrice: number | null;
  exitDate: string | null;
  createdAt: string;
}

const DEFAULTS: Record<Instrument, { target: string; stop: string }> = {
  UVXY: { target: '3', stop: '-15' },
  SVXY: { target: '10', stop: '-20' },
};

function fmtPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function OrderPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [prices, setPrices] = useState<Record<Instrument, number | null>>({ UVXY: null, SVXY: null });
  const [form, setForm] = useState({
    instrument: 'UVXY' as Instrument,
    entryPrice: '',
    entryDate: new Date().toISOString().slice(0, 10),
    targetPct: DEFAULTS.UVXY.target,
    stopPct: DEFAULTS.UVXY.stop,
    notes: '',
  });
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function loadEntries() {
    fetch('/api/journal').then((r) => r.json()).then(setEntries).catch(() => {});
  }

  function loadPrices() {
    fetch('/api/quotes').then((r) => r.json()).then((d) => {
      setPrices({ UVXY: d.uvxy?.price ?? null, SVXY: d.svxy?.price ?? null });
    }).catch(() => {});
  }

  useEffect(() => {
    loadEntries();
    loadPrices();
    const id = setInterval(loadPrices, 30000);
    return () => clearInterval(id);
  }, []);

  function selectInstrument(instrument: Instrument) {
    setForm((f) => ({ ...f, instrument, targetPct: DEFAULTS[instrument].target, stopPct: DEFAULTS[instrument].stop }));
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!form.entryPrice) return;
    setSaving(true);
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument: form.instrument,
          entryPrice: form.entryPrice,
          entryDate: form.entryDate,
          targetPct: form.targetPct,
          stopPct: form.stopPct,
          notes: form.notes,
        }),
      });
      if (res.ok) {
        setForm((f) => ({ ...f, entryPrice: '', notes: '' }));
        loadEntries();
      }
    } finally {
      setSaving(false);
    }
  }

  async function closeEntry(id: string) {
    const exitPrice = closing[id];
    if (!exitPrice) return;
    await fetch(`/api/journal/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exitPrice, exitDate: new Date().toISOString().slice(0, 10), status: 'closed' }),
    });
    setClosing((c) => { const n = { ...c }; delete n[id]; return n; });
    loadEntries();
  }

  async function deleteEntry(id: string) {
    await fetch(`/api/journal/${id}`, { method: 'DELETE' });
    loadEntries();
  }

  function useCurrentPrice() {
    const p = prices[form.instrument];
    if (p != null) setForm((f) => ({ ...f, entryPrice: p.toFixed(2) }));
  }

  const open = entries.filter((e) => e.status === 'open');
  const closed = entries.filter((e) => e.status === 'closed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ background: 'var(--accent-bg)', border: '0.5px solid var(--accent)', borderRadius: 10, padding: '0.85rem 1.1rem', fontSize: 13.5, color: 'var(--text-primary)' }}>
        Manual trade journal &mdash; logs and tracks trades you place yourself, in either UVXY (VIX-dip momentum) or SVXY (VIX-spike mean-reversion). This does not send orders to a broker.
        Live IBKR order execution is planned as a separate follow-up.
      </div>

      <form onSubmit={submitEntry} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '1.25rem 1.5rem' }}>
        <h2 style={{ fontSize: 16, margin: '0 0 1rem', fontWeight: 600 }}>Log a new trade</h2>

        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 8, padding: 4, marginBottom: '0.9rem', width: 'fit-content' }}>
          <InstrumentButton active={form.instrument === 'UVXY'} onClick={() => selectInstrument('UVXY')}>UVXY</InstrumentButton>
          <InstrumentButton active={form.instrument === 'SVXY'} onClick={() => selectInstrument('SVXY')}>SVXY</InstrumentButton>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <Field label="Entry price ($)">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" step="0.01" required value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })} style={{ width: '100%' }} />
              <button type="button" onClick={useCurrentPrice} title={`Use current ${form.instrument} price`} style={{ border: '0.5px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-secondary)', borderRadius: 6, padding: '0 0.6rem' }}>now</button>
            </div>
          </Field>
          <Field label="Entry date">
            <input type="date" required value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} style={{ width: '100%' }} />
          </Field>
          <Field label="Target (%)">
            <input type="number" step="0.5" value={form.targetPct} onChange={(e) => setForm({ ...form, targetPct: e.target.value })} style={{ width: '100%' }} />
          </Field>
          <Field label="Stop (%)">
            <input type="number" step="0.5" value={form.stopPct} onChange={(e) => setForm({ ...form, stopPct: e.target.value })} style={{ width: '100%' }} />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ width: '100%' }} placeholder={form.instrument === 'UVXY' ? 'e.g. VIX 13.8 close, entering on open' : 'e.g. VIX 28.4 close, mean-reversion entry'} />
        </Field>
        <button type="submit" disabled={saving} style={{ marginTop: '1rem', background: 'var(--accent)', color: '#201c13', border: 'none', borderRadius: 7, padding: '0.6rem 1.3rem', fontWeight: 700 }}>
          {saving ? 'Saving…' : 'Log trade'}
        </button>
      </form>

      <section>
        <h2 style={{ fontSize: 15, margin: '0 0 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Open positions ({open.length})</h2>
        {open.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No open positions logged.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {open.map((e) => {
              const inst: Instrument = e.instrument === 'SVXY' ? 'SVXY' : 'UVXY';
              const target = e.entryPrice * (1 + e.targetPct / 100);
              const stop = e.entryPrice * (1 + e.stopPct / 100);
              const currentPrice = prices[inst];
              const pnlPct = currentPrice != null ? ((currentPrice - e.entryPrice) / e.entryPrice) * 100 : null;
              return (
                <div key={e.id} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '0.9rem 1.1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="num" style={{ fontSize: 13.5 }}>
                    <div><InstrumentTag instrument={inst} /> Entry ${e.entryPrice.toFixed(2)} &middot; {e.entryDate}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>target ${target.toFixed(2)} ({fmtPct(e.targetPct)}) &middot; stop ${stop.toFixed(2)} ({fmtPct(e.stopPct)})</div>
                    {e.notes && <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', marginTop: 2 }}>{e.notes}</div>}
                  </div>
                  {pnlPct != null && (
                    <div className="num" style={{ fontSize: 18, fontWeight: 700, color: pnlPct >= 0 ? 'var(--win)' : 'var(--loss)' }}>
                      {fmtPct(pnlPct)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number" step="0.01" placeholder="exit $"
                      value={closing[e.id] ?? ''}
                      onChange={(ev) => setClosing((c) => ({ ...c, [e.id]: ev.target.value }))}
                      style={{ width: 90 }}
                    />
                    <button onClick={() => closeEntry(e.id)} style={{ background: 'var(--win-bg)', color: 'var(--win)', border: '0.5px solid var(--win)', borderRadius: 6, padding: '0.4rem 0.7rem', fontWeight: 600 }}>Close</button>
                    <button onClick={() => deleteEntry(e.id)} style={{ background: 'transparent', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.4rem 0.6rem' }}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, margin: '0 0 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Closed trades ({closed.length})</h2>
        {closed.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No closed trades yet.</p>
        ) : (
          <div className="table-wrap" style={{ overflowX: 'auto', border: '0.5px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={th}>Instrument</th><th style={th}>Entry</th><th style={th}>Exit</th><th style={th}>P&amp;L</th><th style={th}>Dates</th><th style={th}>Notes</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {closed.map((e) => {
                  const inst: Instrument = e.instrument === 'SVXY' ? 'SVXY' : 'UVXY';
                  const pnl = e.exitPrice != null ? ((e.exitPrice - e.entryPrice) / e.entryPrice) * 100 : null;
                  return (
                    <tr key={e.id} style={{ borderTop: '0.5px solid var(--border)' }}>
                      <td style={td}><InstrumentTag instrument={inst} /></td>
                      <td className="num" style={td}>${e.entryPrice.toFixed(2)}</td>
                      <td className="num" style={td}>{e.exitPrice != null ? `$${e.exitPrice.toFixed(2)}` : '—'}</td>
                      <td className="num" style={{ ...td, color: pnl != null ? (pnl >= 0 ? 'var(--win)' : 'var(--loss)') : undefined, fontWeight: 600 }}>{pnl != null ? fmtPct(pnl) : '—'}</td>
                      <td className="num" style={td}>{e.entryDate} &rarr; {e.exitDate || '—'}</td>
                      <td style={td}>{e.notes}</td>
                      <td style={td}><button onClick={() => deleteEntry(e.id)} style={{ background: 'transparent', color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.25rem 0.5rem' }}>Delete</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const th: React.CSSProperties = { padding: '0.55rem 0.7rem', fontWeight: 600, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.03em' };
const td: React.CSSProperties = { padding: '0.55rem 0.7rem' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
      {label}
      {children}
    </label>
  );
}

function InstrumentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
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

function InstrumentTag({ instrument }: { instrument: Instrument }) {
  return (
    <span style={{
      display: 'inline-block', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
      padding: '0.1rem 0.4rem', borderRadius: 5, marginRight: 6,
      background: instrument === 'SVXY' ? 'var(--win-bg)' : 'var(--accent-bg)',
      color: instrument === 'SVXY' ? 'var(--win)' : 'var(--accent)',
    }}>
      {instrument}
    </span>
  );
}

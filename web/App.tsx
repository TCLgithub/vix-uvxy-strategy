import React, { useState } from 'react';
import ChartPage from './components/ChartPage';
import OrderPage from './components/OrderPage';

type Tab = 'chart' | 'order';

export default function App() {
  const [tab, setTab] = useState<Tab>('chart');

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1.25rem 4rem' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 0.35rem', fontWeight: 600 }}>
            VIX &rarr; UVXY strategy
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>Signal monitor &amp; trade journal</h1>
        </div>
        <nav style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 4 }}>
          <TabButton active={tab === 'chart'} onClick={() => setTab('chart')}>Chart</TabButton>
          <TabButton active={tab === 'order'} onClick={() => setTab('order')}>Order</TabButton>
        </nav>
      </header>
      {tab === 'chart' ? <ChartPage /> : <OrderPage />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.5rem 1.1rem',
        borderRadius: 7,
        border: 'none',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

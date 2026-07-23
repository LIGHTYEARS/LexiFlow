import React from 'react';
import { useQuery, callMessage } from '@shared/ui/use-message';
import type { DashboardCounts } from '@shared/protocol/protocol-map';

/**
 * Popup — quick entry (PRD §5.3): today due, overdue, Inbox count, new this
 * week, and common actions.
 */
export default function App(): React.JSX.Element {
  const { data, loading, error } = useQuery<DashboardCounts>('dashboard/counts');

  const open = (destination: string) => {
    void callMessage('navigation/open', { destination });
    window.close();
  };

  return (
    <div
      style={{
        width: '320px',
        minHeight: '360px',
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '18px', marginBottom: '16px' }}>LexiFlow</h1>

      {loading && <p style={{ color: '#666', fontSize: '14px' }}>Loading…</p>}
      {error && <p style={{ color: '#dc2626', fontSize: '13px' }}>{error}</p>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <Stat label="Due today" value={data.todayDue} />
          <Stat label="Overdue" value={data.overdue} highlight={data.overdue > 0} />
          <Stat label="Inbox" value={data.inbox} />
          <Stat label="New this week" value={data.newThisWeek} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <ActionButton primary onClick={() => open('review')}>Start today review</ActionButton>
        <ActionButton onClick={() => open('inbox')}>Open Inbox</ActionButton>
        <ActionButton onClick={() => open('dashboard')}>Open Dashboard</ActionButton>
        <ActionButton onClick={() => open('settings')}>Settings</ActionButton>
      </div>

      <p style={{ color: '#999', fontSize: '12px', marginTop: '12px' }}>v0.1.0</p>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }): React.JSX.Element {
  return (
    <div style={{ padding: '10px', borderRadius: '8px', background: highlight ? '#fef2f2' : '#f5f5f5' }}>
      <div style={{ fontSize: '22px', fontWeight: 600, color: highlight ? '#dc2626' : '#111' }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#666' }}>{label}</div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 12px',
        borderRadius: '8px',
        border: primary ? 'none' : '1px solid #e0e0e0',
        background: primary ? '#4f46e5' : '#fff',
        color: primary ? '#fff' : '#333',
        fontSize: '14px',
        fontWeight: primary ? 600 : 400,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {children}
    </button>
  );
}

import React, { useState, useEffect } from 'react';

interface DashboardCounts {
  todayDue: number;
  overdue: number;
  inbox: number;
  newThisWeek: number;
}

export default function App(): React.JSX.Element {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await chrome.runtime.sendMessage({
          protocolVersion: 1,
          type: 'dashboard/counts',
          requestId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: {},
        });
        if (res?.ok) {
          setCounts(res.data);
        }
      } catch (e) {
        console.error('Failed to load counts:', e);
      }
    };
    load();
  }, []);

  const openDashboard = (route: string) => {
    chrome.runtime.sendMessage({
      protocolVersion: 1,
      type: 'navigation/open',
      requestId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { destination: route },
    });
    window.close();
  };

  return (
    <div style={{ width: '320px', padding: '16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>LexiFlow</h1>
        <button
          onClick={() => openDashboard('settings')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px' }}
          title="Settings"
        >
          ⚙
        </button>
      </div>

      {counts && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={() => openDashboard('review')}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#4f46e5' }}>{counts.todayDue}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Today Review</div>
          </button>
          <button
            onClick={() => openDashboard('review')}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#dc2626' }}>{counts.overdue}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Overdue</div>
          </button>
          <button
            onClick={() => openDashboard('inbox')}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>{counts.inbox}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Inbox</div>
          </button>
          <button
            onClick={() => openDashboard('cards')}
            style={{ padding: '12px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#10b981' }}>{counts.newThisWeek}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>New This Week</div>
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          onClick={() => openDashboard('review')}
          style={{ padding: '10px', borderRadius: '6px', border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
        >
          Start Review
        </button>
        <button
          onClick={() => openDashboard('inbox')}
          style={{ padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
        >
          Open Inbox
        </button>
        <button
          onClick={() => openDashboard('cards')}
          style={{ padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
        >
          Browse Cards
        </button>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';

interface PageSummary {
  pageId: string;
  pageUrl: string;
  title: string;
  cardCount: number;
  inboxCount: number;
}

export default function App(): React.JSX.Element {
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // Get the current tab's URL
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const res = await chrome.runtime.sendMessage({
          protocolVersion: 1,
          type: 'page/summary',
          requestId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: { pageUrl: tab?.url || '' },
        });
        if (res?.ok) {
          setSummary(res.data);
        }
      } catch (e) {
        console.error('Failed to load page summary:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div style={{ padding: '16px', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Page Summary</h2>
      {loading ? (
        <p>Loading...</p>
      ) : summary ? (
        <div>
          {summary.title && (
            <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
              {summary.title}
            </div>
          )}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#4f46e5' }}>{summary.cardCount}</div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>Cards</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>{summary.inboxCount}</div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>Inbox</div>
            </div>
          </div>
          <button
            onClick={() => chrome.runtime.sendMessage({
              protocolVersion: 1,
              type: 'navigation/open',
              requestId: crypto.randomUUID(),
              occurredAt: new Date().toISOString(),
              payload: { destination: 'cards' },
            })}
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer' }}
          >
            View All Cards
          </button>
        </div>
      ) : (
        <p style={{ color: '#666' }}>No data for this page yet.</p>
      )}
    </div>
  );
}

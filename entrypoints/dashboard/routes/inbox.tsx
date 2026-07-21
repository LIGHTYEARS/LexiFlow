import React, { useState, useEffect } from 'react';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';
import type { DashboardCounts } from '@shared/protocol/protocol-map';

export default function Inbox(): React.JSX.Element {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData(): Promise<void> {
    try {
      const [countsResult, inboxResult] = await Promise.all([
        sendMessage<AppResult<DashboardCounts>>('dashboard/counts'),
        sendMessage<AppResult<{ items: any[]; total: number }>>('inbox/list', {
          status: 'pending',
          limit: 50,
        }),
      ]);
      if (countsResult.ok) {
        setCounts(countsResult.data);
      }
      if (inboxResult.ok) {
        setItems(inboxResult.data.items);
      }
    } catch {
      setError('Failed to load inbox.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Inbox</h2>

      {counts && (
        <div
          style={{
            padding: '12px 16px',
            background: '#f5f5f5',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'inline-block',
          }}
        >
          <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>
            Pending items
          </p>
          <p style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>
            {counts.inbox}
          </p>
        </div>
      )}

      {loading && (
        <p style={{ color: '#999', fontSize: '14px' }}>Loading…</p>
      )}

      {error && (
        <p style={{ color: '#dc2626', fontSize: '14px' }}>{error}</p>
      )}

      {!loading && items.length === 0 && (
        <p style={{ color: '#999', fontSize: '14px' }}>
          No pending items. Saved selections will appear here for review.
        </p>
      )}

      {!loading && items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((item: any) => (
            <li
              key={item.id}
              style={{
                padding: '12px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <div style={{ fontSize: '14px', marginBottom: '4px' }}>
                {item.sourceCaptureId ? `Capture: ${item.sourceCaptureId}` : 'Inbox item'}
              </div>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Status: {item.status}
              </div>
              {item.createdAt && (
                <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

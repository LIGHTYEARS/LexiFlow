import React, { useState, useEffect } from 'react';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';
import type { DashboardCounts } from '@shared/protocol/protocol-map';

export default function Inbox(): React.JSX.Element {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadCounts();
  }, []);

  async function loadCounts(): Promise<void> {
    try {
      const result = await sendMessage<AppResult<DashboardCounts>>('dashboard/counts');
      if (result.ok) {
        setCounts(result.data);
      } else {
        setError(result.error.userMessage);
      }
    } catch {
      setError('Failed to load inbox count.');
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

      <p style={{ color: '#666', fontSize: '14px', marginTop: '8px' }}>
        Inbox items will appear here after saving selections.
      </p>
    </div>
  );
}

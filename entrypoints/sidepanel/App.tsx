import React, { useEffect, useState } from 'react';
import { callMessage } from '@shared/ui/use-message';
import type { PageSummary } from '@shared/protocol/protocol-map';

/**
 * Sidepanel — current-page learning summary (PRD §5.2): captured cards for
 * this page, pending Inbox items, and a summary. Re-queries when the active
 * tab's URL changes.
 */
export default function App(): React.JSX.Element {
  const [summary, setSummary] = useState<PageSummary | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(undefined);
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const data = await callMessage<PageSummary>('page/summary', { pageUrl: tab?.url, tabId: tab?.id });
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const listener = (): void => void load();
    chrome.tabs.onActivated.addListener(listener);
    chrome.tabs.onUpdated.addListener(listener);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(listener);
      chrome.tabs.onUpdated.removeListener(listener);
    };
  }, []);

  return (
    <div style={{ padding: '16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: '16px', marginBottom: '12px' }}>Current Page</h1>
      {loading && <p style={{ color: '#666', fontSize: '14px' }}>Loading…</p>}
      {error && <p style={{ color: '#dc2626', fontSize: '13px' }}>{error}</p>}
      {summary && !summary.pageId && !loading && (
        <p style={{ color: '#666', fontSize: '14px' }}>No captures from this page yet.</p>
      )}
      {summary && summary.pageId && (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{summary.title || summary.pageUrl}</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '12px', wordBreak: 'break-all' }}>{summary.pageUrl}</div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Metric label="Cards" value={summary.cardCount} />
            <Metric label="In Inbox" value={summary.inboxCount} />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => void callMessage('navigation/open', { destination: 'dashboard' })}
        style={{
          marginTop: '16px',
          padding: '8px 12px',
          borderRadius: '6px',
          border: '1px solid #e0e0e0',
          background: '#fff',
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        Open Dashboard
      </button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#f5f5f5' }}>
      <div style={{ fontSize: '20px', fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#666' }}>{label}</div>
    </div>
  );
}

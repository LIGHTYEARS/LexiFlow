import React, { useState, useEffect } from 'react';
import { sendMessage, getActiveTab } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';
import type { DashboardCounts, PageSummary, PageSummaryQuery } from '@shared/protocol/protocol-map';

export default function App(): React.JSX.Element {
  const [pageUrl, setPageUrl] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData(): Promise<void> {
    try {
      const tab = await getActiveTab();
      if (tab) {
        setPageUrl(tab.url || '');
        setPageTitle(tab.title || '');
      }

      const summaryPayload: PageSummaryQuery = { pageUrl: tab?.url || '' };
      const summaryResult = await sendMessage<AppResult<PageSummary>>(
        'page/summary',
        summaryPayload,
      );
      if (summaryResult.ok) {
        setSummary(summaryResult.data);
      }

      const countsResult = await sendMessage<AppResult<DashboardCounts>>('dashboard/counts');
      if (countsResult.ok) {
        setCounts(countsResult.data);
      }
    } catch {
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }

  function openDashboard(): void {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }

  return (
    <div
      style={{
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '16px', marginBottom: '12px' }}>Current Page</h1>

      {pageTitle && (
        <p style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px' }}>
          {pageTitle}
        </p>
      )}
      {pageUrl && (
        <p
          style={{
            color: '#666',
            fontSize: '12px',
            margin: '0 0 12px',
            wordBreak: 'break-all',
          }}
        >
          {pageUrl}
        </p>
      )}

      <section style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '14px', marginBottom: '8px' }}>Page Summary</h2>
        {summary ? (
          <div>
            <p style={{ fontSize: '13px', margin: '0 0 4px' }}>
              Cards: {summary.cardCount}
            </p>
            <p style={{ fontSize: '13px', margin: 0 }}>
              Inbox items: {summary.inboxCount}
            </p>
          </div>
        ) : (
          <p style={{ color: '#999', fontSize: '13px' }}>
            {loading ? 'Loading…' : 'No summary available.'}
          </p>
        )}
      </section>

      <section style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '14px', marginBottom: '8px' }}>Saved Cards</h2>
        {counts ? (
          <p style={{ fontSize: '13px', margin: 0 }}>
            {counts.newThisWeek} new this week
          </p>
        ) : (
          <p style={{ color: '#999', fontSize: '13px' }}>
            {loading ? 'Loading…' : 'No data available.'}
          </p>
        )}
      </section>

      {error && (
        <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '12px' }}>
          {error}
        </p>
      )}

      <button
        onClick={openDashboard}
        style={{
          padding: '8px 16px',
          background: '#4f46e5',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          width: '100%',
        }}
      >
        Open Dashboard
      </button>
    </div>
  );
}

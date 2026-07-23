import React, { useState, useEffect } from 'react';

interface DashboardCounts {
  todayDue: number;
  overdue: number;
  inbox: number;
  newThisWeek: number;
}

export default function App(): React.JSX.Element {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [siteEnabled, setSiteEnabled] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);

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

    // Get current tab URL and check if site is enabled
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url) {
        setCurrentUrl(tab.url);
        chrome.runtime.sendMessage({
          protocolVersion: 1,
          type: 'page/check-access',
          requestId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: { url: tab.url },
        }).then((res) => {
          if (res?.ok) {
            setSiteEnabled(res.data.enabled);
          }
        }).catch(() => {});
      }
    });
  }, []);

  const enableSite = async () => {
    setEnabling(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab?.url) return;
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'page/enable-site',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { url: tab.url, tabId: tab.id },
      });
      if (res?.ok) {
        setSiteEnabled(true);
      }
    } catch (e) {
      console.error('Failed to enable site:', e);
    } finally {
      setEnabling(false);
    }
  };

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

  const isWebPage = currentUrl.startsWith('http://') || currentUrl.startsWith('https://');

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

      {/* Site access control */}
      {isWebPage && (
        <div style={{ marginBottom: '16px', padding: '12px', borderRadius: '8px', background: siteEnabled ? '#f0fdf4' : '#fef3c7' }}>
          {siteEnabled === null ? (
            <div style={{ fontSize: '13px', color: '#6b7280' }}>Checking site access...</div>
          ) : siteEnabled ? (
            <div style={{ fontSize: '13px', color: '#166534' }}>
              ✓ LexiFlow is active on this site. Select text to see the explain button.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13px', color: '#92400e', marginBottom: '8px' }}>
                LexiFlow is not active on this site.
              </div>
              <button
                onClick={enableSite}
                disabled={enabling}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer', fontSize: '13px' }}
              >
                {enabling ? 'Enabling...' : 'Enable on This Site'}
              </button>
            </div>
          )}
        </div>
      )}

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

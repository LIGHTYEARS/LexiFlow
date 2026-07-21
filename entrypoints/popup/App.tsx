import React, { useState, useEffect } from 'react';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';

export default function App(): React.JSX.Element {
  const [currentUrl, setCurrentUrl] = useState('');
  const [siteEnabled, setSiteEnabled] = useState(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    void checkCurrentSite();
  }, []);

  async function checkCurrentSite(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || '';
      setCurrentUrl(url);
      if (url) {
        const result = await sendMessage<AppResult<{ enabled: boolean }>>(
          'page/check-access',
          { url },
        );
        if (result.ok) {
          setSiteEnabled(result.data.enabled);
        }
      }
    } catch {
      // Ignore errors in popup
    }
  }

  async function handleEnableSite(): Promise<void> {
    if (!currentUrl) return;
    setStatus('Enabling…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await sendMessage<
        AppResult<{ granted: boolean; originPattern: string }>
      >('page/enable-site', { url: currentUrl, tabId: tab?.id });
      if (result.ok && result.data.granted) {
        setSiteEnabled(true);
        setStatus('Enabled. Refresh the page to start using LexiFlow.');
      } else {
        setStatus('Failed to enable. Check extension permissions.');
      }
    } catch {
      setStatus('Failed to enable.');
    }
  }

  async function handleDisableSite(): Promise<void> {
    if (!currentUrl) return;
    setStatus('Disabling…');
    try {
      const result = await sendMessage<AppResult<{ removed: boolean }>>(
        'page/disable-site',
        { url: currentUrl },
      );
      if (result.ok && result.data.removed) {
        setSiteEnabled(false);
        setStatus('Disabled.');
      }
    } catch {
      setStatus('Failed to disable.');
    }
  }

  const openDashboard = (route: string): void => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#/${route}`) });
  };

  const hostname = currentUrl
    ? (() => { try { return new URL(currentUrl).hostname; } catch { return currentUrl; } })()
    : 'unknown page';

  return (
    <div
      style={{
        width: '320px',
        minHeight: '400px',
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '18px', marginBottom: '16px' }}>LexiFlow</h1>

      {/* Current site access */}
      <div
        style={{
          marginBottom: '16px',
          padding: '12px',
          background: siteEnabled ? '#f0fdf4' : '#fff7ed',
          borderRadius: '8px',
          border: `1px solid ${siteEnabled ? '#bbf7d0' : '#fed7aa'}`,
        }}
      >
        <div style={{ fontSize: '13px', color: '#333', marginBottom: '8px' }}>
          {hostname}
        </div>
        {siteEnabled ? (
          <>
            <div style={{ fontSize: '14px', color: '#16a34a', marginBottom: '8px' }}>
              ✓ LexiFlow is enabled on this site
            </div>
            <button
              onClick={handleDisableSite}
              style={{
                padding: '6px 12px',
                background: '#fff',
                color: '#dc2626',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Disable
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: '14px', color: '#9a3412', marginBottom: '8px' }}>
              LexiFlow is not enabled on this site
            </div>
            <button
              onClick={handleEnableSite}
              style={{
                padding: '8px 16px',
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Enable on this site
            </button>
          </>
        )}
        {status && (
          <p style={{ fontSize: '12px', color: '#666', margin: '8px 0 0' }}>
            {status}
          </p>
        )}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <p style={{ color: '#666', fontSize: '14px', margin: '0 0 8px' }}>
          Select text on any page and press Alt+L to explain it.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          onClick={() => openDashboard('review')}
          style={{
            padding: '10px 16px',
            background: '#4f46e5',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            textAlign: 'left',
          }}
        >
          Today Review
        </button>
        <button
          onClick={() => openDashboard('inbox')}
          style={{
            padding: '10px 16px',
            background: '#4f46e5',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            textAlign: 'left',
          }}
        >
          Inbox
        </button>
        <button
          onClick={() => openDashboard('settings')}
          style={{
            padding: '10px 16px',
            background: '#fff',
            color: '#333',
            border: '1px solid #ddd',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            textAlign: 'left',
          }}
        >
          Settings
        </button>
      </div>

      <p style={{ color: '#999', fontSize: '12px', marginTop: '16px' }}>
        v0.1.0 — M4 Alpha
      </p>
    </div>
  );
}

import React from 'react';

export default function App(): React.JSX.Element {
  const openDashboard = (route: string): void => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html#/${route}`) });
  };

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

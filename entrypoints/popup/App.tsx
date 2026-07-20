import React from 'react';

export default function App(): React.JSX.Element {
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
      <p style={{ color: '#666', fontSize: '14px' }}>
        Today review, Inbox, and quick actions will appear here.
      </p>
      <p style={{ color: '#999', fontSize: '12px', marginTop: '8px' }}>
        v0.1.0 — M0 Scaffold
      </p>
    </div>
  );
}

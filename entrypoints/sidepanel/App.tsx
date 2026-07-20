import React from 'react';

export default function App(): React.JSX.Element {
  return (
    <div
      style={{
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '16px', marginBottom: '12px' }}>Current Page</h1>
      <p style={{ color: '#666', fontSize: '14px' }}>
        Captured content and page summary will appear here.
      </p>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';
import type { SearchResult, SearchCommand } from '@shared/protocol/protocol-map';

export default function Cards(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'error'; message: string }>(
    { type: 'idle', message: '' },
  );

  // Load all cards on mount
  useEffect(() => {
    void doSearch('');
  }, []);

  async function doSearch(q: string): Promise<void> {
    setSearching(true);
    setStatus({ type: 'idle', message: '' });
    try {
      const payload: SearchCommand = { query: q };
      const result = await sendMessage<AppResult<SearchResult>>(
        'knowledge/search',
        payload,
      );
      if (result.ok) {
        setResults(result.data);
      } else {
        setResults(null);
        setStatus({ type: 'error', message: 'Search is not available yet.' });
      }
    } catch {
      setResults(null);
      setStatus({ type: 'error', message: 'Search is not available yet.' });
    } finally {
      setSearching(false);
    }
  }

  async function handleSearch(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await doSearch(query.trim());
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    background: searching ? '#9ca3af' : '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: searching ? 'not-allowed' : 'pointer',
    fontSize: '14px',
  };

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>All Cards</h2>

      <form onSubmit={handleSearch} style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cards…"
            style={inputStyle}
          />
          <button type="submit" disabled={searching} style={buttonStyle}>
            {searching ? '…' : 'Search'}
          </button>
        </div>
      </form>

      {status.type !== 'idle' && (
        <p style={{ color: '#dc2626', fontSize: '14px' }}>{status.message}</p>
      )}

      {results && (
        <div>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>
            {results.total} result{results.total === 1 ? '' : 's'}
          </p>
          {results.items.length === 0 ? (
            <p style={{ color: '#999', fontSize: '14px' }}>No cards found.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {results.items.map((item) => (
                <li
                  key={item.cardId}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>
                    {item.headword}
                  </span>
                  <span
                    style={{
                      fontSize: '12px',
                      color: '#888',
                      marginLeft: '8px',
                    }}
                  >
                    {item.type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

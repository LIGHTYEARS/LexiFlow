import React, { useState, useEffect, useCallback } from 'react';

interface InboxItem {
  item: {
    id: string;
    status: string;
    createdAt: string;
  };
  selectedText: string;
  pageTitle?: string;
  url?: string;
}

const CARD_STYLE: React.CSSProperties = {
  padding: '16px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  marginBottom: '12px',
  background: '#fff',
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  fontSize: '13px',
  cursor: 'pointer',
  marginRight: '8px',
};

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
};

const DANGER_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  background: '#fff',
  color: '#dc2626',
  border: '1px solid #fecaca',
};

export default function Inbox(): React.JSX.Element {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'inbox/list',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { limit: 50 },
      });
      if (res?.ok) {
        setItems(res.data.items || []);
      }
    } catch (e) {
      console.error('Failed to load inbox:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const convertToCard = useCallback(async (itemId: string, cardType: string) => {
    setStatus('Converting...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'inbox/convert',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { itemId, cardType },
      });
      if (res?.ok) {
        setStatus('Converted to card');
        await loadItems();
        setTimeout(() => setStatus(''), 2000);
      } else {
        setStatus('Error: ' + (res?.error?.userMessage || 'unknown'));
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    }
  }, [loadItems]);

  const discardItem = useCallback(async (itemId: string) => {
    if (!confirm('Discard this inbox item?')) return;
    setStatus('Discarding...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'inbox/discard',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { itemId },
      });
      if (res?.ok) {
        setStatus('Discarded');
        await loadItems();
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    }
  }, [loadItems]);

  if (loading) {
    return <div style={{ padding: '24px' }}>Loading inbox...</div>;
  }

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Inbox</h2>
      {status && (
        <div style={{ padding: '8px 12px', background: '#f0fdf4', color: '#166534', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
          {status}
        </div>
      )}
      {items.length === 0 ? (
        <p style={{ color: '#666' }}>No pending items. Capture content from web pages to see it here.</p>
      ) : (
        <div>
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
            {items.length} item{items.length !== 1 ? 's' : ''} pending
          </p>
          {items.map((item) => (
            <div key={item.item.id} style={CARD_STYLE}>
              <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '4px' }}>
                {item.selectedText}
              </div>
              {item.pageTitle && (
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                  From: {item.pageTitle}
                </div>
              )}
              {item.url && (
                <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '12px' }}>
                  {item.url}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                <button style={PRIMARY_BUTTON_STYLE} onClick={() => convertToCard(item.item.id, 'word')}>
                  Create Word Card
                </button>
                <button style={PRIMARY_BUTTON_STYLE} onClick={() => convertToCard(item.item.id, 'phrase')}>
                  Create Phrase Card
                </button>
                <button style={PRIMARY_BUTTON_STYLE} onClick={() => convertToCard(item.item.id, 'sentence')}>
                  Create Sentence Card
                </button>
                <button style={PRIMARY_BUTTON_STYLE} onClick={() => convertToCard(item.item.id, 'technical_term')}>
                  Create Term Card
                </button>
                <button style={DANGER_BUTTON_STYLE} onClick={() => discardItem(item.item.id)}>
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';

interface CardItem {
  cardId: string;
  headword: string;
  type: string;
  score?: number;
}

const CARD_STYLE: React.CSSProperties = {
  padding: '12px 16px',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  marginBottom: '8px',
  background: '#fff',
  cursor: 'pointer',
};

const TYPE_BADGE: Record<string, React.CSSProperties> = {
  word: { background: '#eef2ff', color: '#4338ca' },
  phrase: { background: '#f0fdf4', color: '#166534' },
  sentence: { background: '#fef3c7', color: '#92400e' },
  technical_term: { background: '#fdf2f8', color: '#9d174d' },
};

export default function Cards(): React.JSX.Element {
  const [cards, setCards] = useState<CardItem[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'knowledge/search',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          query,
          filters: typeFilter ? { type: typeFilter } : undefined,
          limit: 100,
        },
      });
      if (res?.ok) {
        setCards(res.data.items || []);
      }
    } catch (e) {
      console.error('Failed to load cards:', e);
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>All Cards</h2>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search cards..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
        >
          <option value="">All types</option>
          <option value="word">Word</option>
          <option value="phrase">Phrase</option>
          <option value="sentence">Sentence</option>
          <option value="technical_term">Technical Term</option>
        </select>
      </div>
      {loading ? (
        <p>Loading...</p>
      ) : cards.length === 0 ? (
        <p style={{ color: '#666' }}>No cards found. Capture content from web pages to build your library.</p>
      ) : (
        <div>
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '12px' }}>{cards.length} cards</p>
          {cards.map((card) => (
            <div
              key={card.cardId}
              style={CARD_STYLE}
              onClick={() => setSelectedCard(card.cardId)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: 500 }}>{card.headword}</span>
                <span style={{ ...TYPE_BADGE[card.type] || {}, padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
                  {card.type}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {selectedCard && <CardDetail cardId={selectedCard} onClose={() => setSelectedCard(null)} />}
    </div>
  );
}

function CardDetail({ cardId, onClose }: { cardId: string; onClose: () => void }): React.JSX.Element {
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await chrome.runtime.sendMessage({
          protocolVersion: 1,
          type: 'knowledge/getCard',
          requestId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: { cardId },
        });
        if (res?.ok) {
          setCard(res.data);
        }
      } catch (e) {
        console.error('Failed to load card:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [cardId]);

  if (loading) return <div style={{ padding: '16px' }}>Loading...</div>;
  if (!card) return <div style={{ padding: '16px' }}>Card not found</div>;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: '8px', padding: '24px', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflow: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '18px', margin: 0 }}>{card.headword}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <span style={{ ...TYPE_BADGE[card.type] || {}, padding: '2px 8px', borderRadius: '4px', fontSize: '11px' }}>
            {card.type}
          </span>
          <span style={{ marginLeft: '8px', fontSize: '12px', color: '#6b7280' }}>
            Status: {card.status}
          </span>
        </div>
        {card.explanations?.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Explanations</div>
            {card.explanations.map((e: any, i: number) => (
              <div key={i} style={{ fontSize: '14px', color: '#4b5563' }}>{e.value}</div>
            ))}
          </div>
        )}
        {card.examples?.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Examples</div>
            {card.examples.map((e: any, i: number) => (
              <div key={i} style={{ fontSize: '14px', color: '#4b5563', fontStyle: 'italic' }}>"{e.value}"</div>
            ))}
          </div>
        )}
        {card.sources?.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Sources</div>
            {card.sources.map((s: any, i: number) => (
              <div key={i} style={{ fontSize: '12px', color: '#6b7280' }}>
                {s.pageTitle || s.url} ({s.role})
              </div>
            ))}
          </div>
        )}
        {card.reviewState && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Review</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              State: {card.reviewState.state} | Next: {new Date(card.reviewState.dueAt).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

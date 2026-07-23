import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQuery } from '@shared/ui/use-message';
import type {
  SearchResult,
  SearchResultItem,
  CardDetail,
} from '@shared/protocol/protocol-map';
import type { CardType, CardStatus } from '@domain/types';

/**
 * All Cards route (PRD §11.1, §11.2, §17.1).
 * Debounced full-text search + type/status filters, a virtualized results
 * list, and a card detail panel (explanations/examples/sources/tags/relations/
 * review state) with provenance origins.
 */

const CARD_TYPES: CardType[] = ['word', 'phrase', 'sentence', 'technical_term'];
const CARD_STATUSES: CardStatus[] = ['active', 'paused', 'archived', 'deleted'];

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#333',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const controlStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
};

const originColors: Record<string, string> = {
  web_page: '#0369a1',
  user: '#15803d',
  model: '#9333ea',
};

function OriginBadge({ origin }: { origin: string }): React.JSX.Element {
  return (
    <span
      style={{
        fontSize: '11px',
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: '4px',
        color: '#fff',
        background: originColors[origin] ?? '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
      }}
    >
      {origin}
    </span>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function CardDetailPanel({ cardId }: { cardId: string }): React.JSX.Element {
  const { data, loading, error } = useQuery<CardDetail>(
    'knowledge/getCard',
    { cardId },
    [cardId],
  );

  if (loading) return <p style={{ color: '#666' }}>Loading card…</p>;
  if (error) return <p style={{ color: '#b91c1c' }}>Error: {error}</p>;
  if (!data) return <p style={{ color: '#666' }}>No card selected.</p>;

  return (
    <div>
      <h3 style={{ fontSize: '18px', margin: '0 0 4px' }}>{data.headword}</h3>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '16px' }}>
        {data.type} · {data.status} · rev {data.revision}
      </div>

      <section style={{ marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', margin: '0 0 6px' }}>Explanations</h4>
        {data.explanations.length === 0 ? (
          <p style={{ color: '#999', fontSize: '13px' }}>None.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {data.explanations.map((e, i) => (
              <li key={i} style={{ marginBottom: '4px', fontSize: '14px' }}>
                {e.value} <OriginBadge origin={e.origin} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', margin: '0 0 6px' }}>Examples</h4>
        {data.examples.length === 0 ? (
          <p style={{ color: '#999', fontSize: '13px' }}>None.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {data.examples.map((e, i) => (
              <li key={i} style={{ marginBottom: '4px', fontSize: '14px' }}>
                {e.value} <OriginBadge origin={e.origin} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', margin: '0 0 6px' }}>Sources</h4>
        {data.sources.length === 0 ? (
          <p style={{ color: '#999', fontSize: '13px' }}>None.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {data.sources.map((s, i) => (
              <li key={i} style={{ marginBottom: '4px', fontSize: '13px' }}>
                <span style={{ color: '#666' }}>[{s.role}]</span>{' '}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.pageTitle ?? s.url}
                  </a>
                ) : (
                  s.pageTitle ?? s.sourceCaptureId
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', margin: '0 0 6px' }}>Tags</h4>
        {data.tags.length === 0 ? (
          <p style={{ color: '#999', fontSize: '13px' }}>None.</p>
        ) : (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {data.tags.map((t) => (
              <span
                key={t.id}
                style={{
                  fontSize: '12px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: '#eef2ff',
                  color: '#4f46e5',
                }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: '16px' }}>
        <h4 style={{ fontSize: '14px', margin: '0 0 6px' }}>Relations</h4>
        {data.relations.length === 0 ? (
          <p style={{ color: '#999', fontSize: '13px' }}>None.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {data.relations.map((r, i) => (
              <li key={i} style={{ marginBottom: '4px', fontSize: '13px' }}>
                {r.type}
                {r.direction ? ` (${r.direction})` : ''} → {r.cardId}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 style={{ fontSize: '14px', margin: '0 0 6px' }}>Review state</h4>
        {data.reviewState ? (
          <div style={{ fontSize: '13px', color: '#333' }}>
            <div>State: {data.reviewState.state ?? '—'}</div>
            <div>
              Due:{' '}
              {data.reviewState.dueAt
                ? new Date(data.reviewState.dueAt).toLocaleString()
                : '—'}
            </div>
            <div>Stability: {data.reviewState.stability ?? '—'}</div>
            <div>Difficulty: {data.reviewState.difficulty ?? '—'}</div>
          </div>
        ) : (
          <p style={{ color: '#999', fontSize: '13px' }}>Not yet scheduled.</p>
        )}
      </section>
    </div>
  );
}

function ResultsList({
  items,
  selectedId,
  onSelect,
}: {
  items: SearchResultItem[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      style={{
        height: '560px',
        overflow: 'auto',
        border: '1px solid #eee',
        borderRadius: '8px',
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          const isSelected = item.cardId === selectedId;
          return (
            <button
              key={item.cardId}
              type="button"
              onClick={() => onSelect(item.cardId)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                textAlign: 'left',
                border: 'none',
                borderBottom: '1px solid #f0f0f0',
                background: isSelected ? '#eef2ff' : '#fff',
                cursor: 'pointer',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#111' }}>
                {item.headword}
              </span>
              <span style={{ fontSize: '12px', color: '#666' }}>
                {item.type}
                {item.excerpt ? ` · ${item.excerpt}` : ''}
                {item.matchFields && item.matchFields.length > 0
                  ? ` · matched: ${item.matchFields.join(', ')}`
                  : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Cards(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<CardType | ''>('');
  const [status, setStatus] = useState<CardStatus | ''>('');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const debouncedQuery = useDebounced(query, 300);

  const filters: { type?: CardType; status?: CardStatus } = {};
  if (type) filters.type = type;
  if (status) filters.status = status;

  const { data, loading, error } = useQuery<SearchResult>(
    'knowledge/search',
    { query: debouncedQuery, filters, limit: 200 },
    [debouncedQuery, type, status],
  );

  const items = data?.items ?? [];

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>All Cards</h2>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '16px',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <label style={{ ...labelStyle, flex: '1 1 240px' }}>
          Search
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headword, explanation, example…"
            style={controlStyle}
            aria-label="Search cards"
          />
        </label>

        <label style={labelStyle}>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CardType | '')}
            style={controlStyle}
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            {CARD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CardStatus | '')}
            style={controlStyle}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {CARD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 400px' }}>
          <div
            style={{
              fontSize: '13px',
              color: '#666',
              marginBottom: '8px',
              minHeight: '18px',
            }}
          >
            {loading
              ? 'Searching…'
              : error
                ? ''
                : `${items.length} shown${
                    data?.total !== undefined ? ` of ${data.total}` : ''
                  }`}
          </div>
          {error ? (
            <p style={{ color: '#b91c1c' }}>Error: {error}</p>
          ) : items.length === 0 && !loading ? (
            <p style={{ color: '#999' }}>No cards match.</p>
          ) : (
            <ResultsList
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>

        <div
          style={{
            flex: '1 1 380px',
            border: '1px solid #eee',
            borderRadius: '8px',
            padding: '16px',
            minHeight: '200px',
          }}
        >
          {selectedId ? (
            <CardDetailPanel cardId={selectedId} />
          ) : (
            <p style={{ color: '#999' }}>Select a card to see its details.</p>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useQuery } from '@shared/ui/use-message';
import type {
  SourcePageResult,
  SourcePageListItem,
} from '@shared/protocol/protocol-map';

/**
 * Sources route (PRD §11.3).
 *
 * Lists all source pages (`knowledge/listSources`). Clicking a page loads its
 * detail (`knowledge/listBySource`): title/url/domain/lastCapturedAt, the cards
 * captured from it (with type + role), and its pending inbox count.
 */

const roleColors: Record<string, string> = {
  origin: '#0369a1',
  additional_context: '#9333ea',
  example: '#15803d',
};

function RoleBadge({ role }: { role: string }): React.JSX.Element {
  return (
    <span
      style={{
        fontSize: '11px',
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: '4px',
        color: '#fff',
        background: roleColors[role] ?? '#6b7280',
      }}
    >
      {role}
    </span>
  );
}

function PageDetail({ pageId }: { pageId: string }): React.JSX.Element {
  const { data, loading, error } = useQuery<SourcePageResult>(
    'knowledge/listBySource',
    { pageId },
    [pageId],
  );

  if (loading) return <p style={{ color: '#666' }}>Loading page…</p>;
  if (error) return <p style={{ color: '#b91c1c' }}>Error: {error}</p>;
  if (!data) return <p style={{ color: '#999' }}>No detail.</p>;

  return (
    <div>
      <h3 style={{ fontSize: '18px', margin: '0 0 8px' }}>
        {data.page.title || '(untitled page)'}
      </h3>
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
        <span style={{ fontWeight: 600 }}>{data.page.domain}</span>
      </div>
      {data.page.url && (
        <div style={{ fontSize: '13px', marginBottom: '4px' }}>
          <a href={data.page.url} target="_blank" rel="noreferrer">
            {data.page.url}
          </a>
        </div>
      )}
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
        Last captured:{' '}
        {data.page.lastCapturedAt
          ? new Date(data.page.lastCapturedAt).toLocaleString()
          : '—'}{' '}
        · Pending inbox: <strong>{data.inboxCount}</strong>
      </div>

      <h4 style={{ fontSize: '14px', margin: '16px 0 8px' }}>
        Cards captured ({data.cards.length})
      </h4>
      {data.cards.length === 0 ? (
        <p style={{ color: '#999', fontSize: '13px' }}>
          No cards captured from this page.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.cards.map((c) => (
            <li
              key={c.cardId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <span style={{ fontSize: '14px', fontWeight: 600 }}>
                {c.headword}
              </span>
              <span style={{ fontSize: '12px', color: '#666' }}>{c.type}</span>
              <RoleBadge role={c.role} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Sources(): React.JSX.Element {
  const { data, loading, error } = useQuery<{
    pages: SourcePageListItem[];
    nextCursor?: string;
  }>('knowledge/listSources', { limit: 200 });

  const [selectedPageId, setSelectedPageId] = useState<string | undefined>();

  const pages = data?.pages ?? [];

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>Sources</h2>
      <p style={{ color: '#666', marginTop: 0, marginBottom: '20px' }}>
        Captured pages and the cards they produced.
      </p>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 380px' }}>
          {loading ? (
            <p style={{ color: '#666' }}>Loading sources…</p>
          ) : error ? (
            <p style={{ color: '#b91c1c' }}>Error: {error}</p>
          ) : pages.length === 0 ? (
            <p style={{ color: '#999' }}>No source pages yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {pages.map((p) => {
                const isSelected = p.pageId === selectedPageId;
                return (
                  <li key={p.pageId} style={{ marginBottom: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedPageId(p.pageId)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: '1px solid #eee',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        background: isSelected ? '#eef2ff' : '#fff',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                      }}
                    >
                      <span
                        style={{ fontSize: '14px', fontWeight: 600, color: '#111' }}
                      >
                        {p.title || '(untitled page)'}
                      </span>
                      <span style={{ fontSize: '12px', color: '#666' }}>
                        {p.domain} · {p.cardCount} card
                        {p.cardCount === 1 ? '' : 's'} · {p.inboxCount} pending
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div
          style={{
            flex: '1 1 400px',
            border: '1px solid #eee',
            borderRadius: '8px',
            padding: '16px',
            minHeight: '200px',
          }}
        >
          {selectedPageId ? (
            <PageDetail pageId={selectedPageId} />
          ) : (
            <p style={{ color: '#999' }}>Select a page to see its cards.</p>
          )}
        </div>
      </div>
    </div>
  );
}

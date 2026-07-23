import React from 'react';
import { useQuery, type QueryState } from '@shared/ui/use-message';
import type { DashboardCounts, SearchResult } from '@shared/protocol/protocol-map';
import type { CardType } from '@domain/types';

/**
 * Stats route — PRD §11.5.
 *
 * Data sources are limited to messages that actually exist:
 *  - 'dashboard/counts'  → todayDue / overdue / inbox / newThisWeek
 *  - 'knowledge/search' with an empty query → `total` card count (browse mode),
 *    optionally filtered by card type for a type distribution.
 *
 * There is no dedicated stats/analytics message, so trends over time are NOT
 * shown — PRD §11.5 forbids misleading trends without real data.
 */

const CARD_TYPES: ReadonlyArray<{ key: CardType; label: string; color: string }> = [
  { key: 'word', label: 'Words', color: '#4f46e5' },
  { key: 'phrase', label: 'Phrases', color: '#0ea5e9' },
  { key: 'sentence', label: 'Sentences', color: '#10b981' },
  { key: 'technical_term', label: 'Technical terms', color: '#f59e0b' },
];

const card: React.CSSProperties = {
  border: '1px solid #eee',
  borderRadius: '8px',
  padding: '20px',
  background: '#fff',
};

function StatTile({ label, value }: { label: string; value: number | string }): React.JSX.Element {
  return (
    <div style={{ ...card, minWidth: '150px', flex: '1 1 150px' }}>
      <div style={{ fontSize: '28px', fontWeight: 700, color: '#111' }}>{value}</div>
      <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>{label}</div>
    </div>
  );
}

export default function Stats(): React.JSX.Element {
  const counts = useQuery<DashboardCounts>('dashboard/counts');
  const totalCards = useQuery<SearchResult>('knowledge/search', {
    query: '',
    filters: { status: 'active' },
    limit: 1,
  });

  const word = useQuery<SearchResult>('knowledge/search', {
    query: '',
    filters: { status: 'active', type: 'word' },
    limit: 1,
  });
  const phrase = useQuery<SearchResult>('knowledge/search', {
    query: '',
    filters: { status: 'active', type: 'phrase' },
    limit: 1,
  });
  const sentence = useQuery<SearchResult>('knowledge/search', {
    query: '',
    filters: { status: 'active', type: 'sentence' },
    limit: 1,
  });
  const technical = useQuery<SearchResult>('knowledge/search', {
    query: '',
    filters: { status: 'active', type: 'technical_term' },
    limit: 1,
  });

  const byType: Record<CardType, QueryState<SearchResult>> = {
    word,
    phrase,
    sentence,
    technical_term: technical,
  };

  const total = totalCards.data?.total;
  const anyLoading =
    counts.loading || totalCards.loading || Object.values(byType).some((q) => q.loading);

  return (
    <div style={{ maxWidth: '760px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>Statistics</h2>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '20px' }}>
        Learning overview (PRD §11.5). Figures reflect the current library state; historical
        trends are not shown because no time-series data is collected yet.
      </p>

      {anyLoading && <p style={{ color: '#666' }}>Loading statistics…</p>}

      {/* Review queue */}
      <section style={{ marginBottom: '28px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Review queue</h3>
        {counts.error ? (
          <p style={{ color: '#dc2626' }}>Failed to load counts: {counts.error}</p>
        ) : (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <StatTile label="Due today" value={counts.data?.todayDue ?? '—'} />
            <StatTile label="Overdue" value={counts.data?.overdue ?? '—'} />
            <StatTile label="Inbox items" value={counts.data?.inbox ?? '—'} />
            <StatTile label="New this week" value={counts.data?.newThisWeek ?? '—'} />
          </div>
        )}
      </section>

      {/* Library totals */}
      <section style={{ marginBottom: '28px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Library</h3>
        {totalCards.error ? (
          <p style={{ color: '#dc2626' }}>Failed to load card total: {totalCards.error}</p>
        ) : (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <StatTile label="Active cards" value={total ?? '—'} />
          </div>
        )}
      </section>

      {/* Card type distribution */}
      <section style={{ marginBottom: '28px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Card type distribution</h3>
        <div style={card}>
          {CARD_TYPES.map(({ key, label, color }) => {
            const q = byType[key];
            const n = q.data?.total;
            const pct = total && total > 0 && typeof n === 'number' ? Math.round((n / total) * 100) : 0;
            return (
              <div key={key} style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                  <span>{label}</span>
                  <span style={{ color: '#666' }}>
                    {q.error ? 'error' : n ?? '—'}
                    {typeof n === 'number' && total ? ` (${pct}%)` : ''}
                  </span>
                </div>
                <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      background: color,
                      height: '100%',
                      transition: 'width 0.2s',
                    }}
                    role="presentation"
                  />
                </div>
              </div>
            );
          })}
          <p style={{ fontSize: '12px', color: '#999', margin: '8px 0 0' }}>
            Counts are of active cards, derived from the knowledge index per type.
          </p>
        </div>
      </section>

      <p style={{ fontSize: '12px', color: '#999' }}>
        Note: richer analytics (accuracy over time, retention curves, streaks) require a dedicated
        stats message that is not yet available. Only the metrics above can be reported honestly.
      </p>
    </div>
  );
}

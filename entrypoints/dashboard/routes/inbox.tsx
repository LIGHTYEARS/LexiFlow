import React, { useMemo, useState } from 'react';
import { useQuery, callMessage } from '@shared/ui/use-message';
import type {
  DashboardCounts,
  InboxBatchAction,
  InboxBatchPreview,
  InboxBatchResult,
  InboxListItem,
} from '@shared/protocol/protocol-map';

/**
 * Inbox route (PRD §9.4, §9.5, §19.4).
 *
 * Renders the pending inbox list (`knowledge/listInbox`), lets the user select
 * items via checkboxes, and drives the preview → confirm → apply flow with an
 * undo of the last batch. Per-item dedup suggestions (confidence + target card
 * + rationale) give triage the "why" context (§9.5).
 */

const controlStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  background: '#4f46e5',
  color: '#fff',
};

const secondaryButton: React.CSSProperties = {
  ...buttonStyle,
  background: '#fff',
  color: '#4f46e5',
  border: '1px solid #4f46e5',
};

const ACTIONS: InboxBatchAction[] = ['save', 'skip', 'save-to-inbox', 'merge'];

// The preview message augments InboxBatchPreview with a confirmation token
// (minted server-side in inbox-handlers.ts).
type PreviewWithToken = InboxBatchPreview & { confirmationToken: string };

export default function Inbox(): React.JSX.Element {
  const counts = useQuery<DashboardCounts>('dashboard/counts');
  const list = useQuery<{ items: InboxListItem[]; nextCursor?: string }>(
    'knowledge/listInbox',
    { status: 'pending', limit: 200 },
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<InboxBatchAction>('save');
  const [preview, setPreview] = useState<PreviewWithToken | undefined>();
  const [result, setResult] = useState<InboxBatchResult | undefined>();
  const [lastBatchId, setLastBatchId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const selectedIds = useMemo(() => [...selected], [selected]);
  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(itemId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.itemId)));
  }

  async function handlePreview(): Promise<void> {
    setError(undefined);
    setResult(undefined);
    setPreview(undefined);
    if (selectedIds.length === 0) {
      setError('Select at least one inbox item.');
      return;
    }
    setBusy(true);
    try {
      const p = await callMessage<PreviewWithToken>('inbox/batchPreview', {
        itemIds: selectedIds,
        proposedAction: action,
      });
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(): Promise<void> {
    if (!preview) return;
    setError(undefined);
    setBusy(true);
    try {
      const r = await callMessage<InboxBatchResult>('inbox/batchApply', {
        batchPreviewId: preview.previewId,
        confirmationToken: preview.confirmationToken,
      });
      setResult(r);
      setLastBatchId(r.batchId);
      setPreview(undefined);
      setSelected(new Set());
      counts.reload();
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo(): Promise<void> {
    if (!lastBatchId) return;
    setError(undefined);
    setBusy(true);
    try {
      const r = await callMessage<{ reverted: boolean }>('inbox/undoBatch', {
        batchId: lastBatchId,
        expectedRevision: 0,
      });
      if (r.reverted) {
        setResult(undefined);
        setLastBatchId(undefined);
        counts.reload();
        list.reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo failed');
    } finally {
      setBusy(false);
    }
  }

  const pending = counts.data?.inbox;

  return (
    <div style={{ maxWidth: '820px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>Inbox</h2>
      <p style={{ color: '#666', marginTop: 0, marginBottom: '20px' }}>
        Pending items:{' '}
        <strong>
          {counts.loading ? '…' : counts.error ? '—' : (pending ?? 0)}
        </strong>
      </p>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{
            fontSize: '13px',
            color: '#333',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={items.length === 0}
            aria-label="Select all pending items"
          />
          Select all ({selected.size}/{items.length})
        </label>
        <label style={{ fontSize: '13px', color: '#333' }}>
          Action{' '}
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as InboxBatchAction)}
            style={controlStyle}
            aria-label="Batch action"
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handlePreview}
          disabled={busy || selected.size === 0}
          style={{
            ...secondaryButton,
            opacity: busy || selected.size === 0 ? 0.6 : 1,
          }}
        >
          Preview batch ({selected.size})
        </button>
      </div>

      {error && (
        <p style={{ color: '#b91c1c', marginBottom: '16px' }}>Error: {error}</p>
      )}

      {list.loading ? (
        <p style={{ color: '#666' }}>Loading inbox…</p>
      ) : list.error ? (
        <p style={{ color: '#b91c1c' }}>Error: {list.error}</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#999' }}>No pending items in the inbox.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li
              key={item.itemId}
              style={{
                border: '1px solid #eee',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '10px',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                background: selected.has(item.itemId) ? '#f5f3ff' : '#fff',
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(item.itemId)}
                onChange={() => toggle(item.itemId)}
                aria-label={`Select ${item.selectedText}`}
                style={{ marginTop: '3px' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '4px',
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>
                    {item.selectedText}
                  </span>
                  {item.hasFailure && (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        color: '#fff',
                        background: '#b91c1c',
                      }}
                    >
                      FAILURE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.pageTitle ?? item.url}
                    </a>
                  ) : (
                    (item.pageTitle ?? '(no source page)')
                  )}
                  {' · '}
                  {new Date(item.createdAt).toLocaleString()}
                </div>
                {item.suggestions.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#666',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                        marginBottom: '2px',
                      }}
                    >
                      Suggestions
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '16px' }}>
                      {item.suggestions.map((s, i) => (
                        <li
                          key={i}
                          style={{ fontSize: '12px', color: '#444', marginBottom: '2px' }}
                        >
                          <strong>{s.confidence}</strong>
                          {s.targetCardId ? ` → card ${s.targetCardId}` : ''}
                          {s.rationale ? ` — ${s.rationale}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <section
          style={{
            border: '1px solid #eee',
            borderRadius: '8px',
            padding: '16px',
            marginTop: '16px',
            marginBottom: '24px',
          }}
        >
          <h3 style={{ fontSize: '16px', margin: '0 0 8px' }}>
            Preview — confirm before applying
          </h3>
          <p style={{ fontSize: '13px', color: '#666', marginTop: 0 }}>
            {preview.riskSummary}
          </p>
          <ul style={{ margin: '0 0 16px', paddingLeft: '18px' }}>
            {preview.items.map((it) => (
              <li key={it.itemId} style={{ fontSize: '14px', marginBottom: '4px' }}>
                <strong>{it.action}</strong> — {it.summary}{' '}
                <span style={{ color: '#999', fontSize: '12px' }}>
                  ({it.itemId})
                </span>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={handleApply}
              disabled={busy}
              style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}
            >
              Confirm &amp; apply
            </button>
            <button
              type="button"
              onClick={() => setPreview(undefined)}
              disabled={busy}
              style={secondaryButton}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {result && (
        <section
          style={{
            border: '1px solid #eee',
            borderRadius: '8px',
            padding: '16px',
            marginTop: '16px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <h3 style={{ fontSize: '16px', margin: 0 }}>Results</h3>
            <button
              type="button"
              onClick={handleUndo}
              disabled={busy || !lastBatchId}
              style={{
                ...secondaryButton,
                opacity: busy || !lastBatchId ? 0.6 : 1,
              }}
            >
              Undo last batch
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {result.results.map((r) => (
              <li key={r.itemId} style={{ fontSize: '14px', marginBottom: '4px' }}>
                <span style={{ color: r.success ? '#15803d' : '#b91c1c' }}>
                  {r.success ? '✓' : '✗'}
                </span>{' '}
                {r.itemId}
                {r.cardId ? ` → card ${r.cardId}` : ''}
                {r.error ? ` — ${r.error}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

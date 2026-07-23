import React, { useState } from 'react';
import { useQuery, callMessage } from '@shared/ui/use-message';

/**
 * Tags management (PRD §11.4): list with card counts, create, rename, delete,
 * and merge. Deleting/merging never deletes cards. Destructive ops mint a
 * confirmation token first (§10.2).
 */

interface TagRow {
  id: string;
  name: string;
  cardCount: number;
}

export default function Tags(): React.JSX.Element {
  const { data, loading, error, reload } = useQuery<{ tags: TagRow[] }>('tags/list');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [mergeSource, setMergeSource] = useState<string>('');
  const [mergeTarget, setMergeTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | undefined>();

  const tags = data?.tags ?? [];

  async function withConfirm<T>(fn: (token: string) => Promise<T>): Promise<void> {
    setBusy(true);
    setMsg(undefined);
    try {
      const { token } = await callMessage<{ token: string }>('tags/mintConfirmation', { operation: 'tags.bulk-modify' });
      await fn(token);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await callMessage('tags/create', { name: newName.trim() });
      setNewName('');
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    setBusy(true);
    try {
      await callMessage('tags/rename', { tagId: renaming.id, newName: renaming.name });
      setRenaming(null);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Tags</h2>

      {msg && <p style={{ color: '#dc2626', fontSize: '13px' }}>{msg}</p>}

      {/* Create */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input
          aria-label="New tag name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New tag name"
          style={inputStyle}
        />
        <button type="button" onClick={create} disabled={busy} style={primaryBtn}>
          Add tag
        </button>
      </div>

      {loading && <p style={{ color: '#666' }}>Loading…</p>}
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {/* List */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
            <th style={{ padding: '8px' }}>Tag</th>
            <th style={{ padding: '8px' }}>Cards</th>
            <th style={{ padding: '8px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((tag) => (
            <tr key={tag.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '8px' }}>
                {renaming?.id === tag.id ? (
                  <input
                    aria-label="Rename tag"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: tag.id, name: e.target.value })}
                    style={inputStyle}
                  />
                ) : (
                  tag.name
                )}
              </td>
              <td style={{ padding: '8px', color: '#666' }}>{tag.cardCount}</td>
              <td style={{ padding: '8px', display: 'flex', gap: '6px' }}>
                {renaming?.id === tag.id ? (
                  <>
                    <button type="button" onClick={rename} disabled={busy} style={smallBtn}>Save</button>
                    <button type="button" onClick={() => setRenaming(null)} style={smallBtn}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setRenaming({ id: tag.id, name: tag.name })} style={smallBtn}>
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void withConfirm((token) => callMessage('tags/delete', { tagId: tag.id, confirmationToken: token }))
                      }
                      disabled={busy}
                      style={{ ...smallBtn, color: '#dc2626' }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {tags.length === 0 && !loading && (
            <tr>
              <td colSpan={3} style={{ padding: '16px', color: '#999' }}>No tags yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Merge */}
      {tags.length >= 2 && (
        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
          <h3 style={{ fontSize: '15px', marginBottom: '8px' }}>Merge tags</h3>
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
            Cards are moved to the target tag; the source tag is removed. Cards are never deleted.
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select aria-label="Source tag" value={mergeSource} onChange={(e) => setMergeSource(e.target.value)} style={inputStyle}>
              <option value="">Merge from…</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span>→</span>
            <select aria-label="Target tag" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={inputStyle}>
              <option value="">…into</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              type="button"
              disabled={busy || !mergeSource || !mergeTarget || mergeSource === mergeTarget}
              onClick={() =>
                void withConfirm((token) =>
                  callMessage('tags/merge', { sourceTagId: mergeSource, targetTagId: mergeTarget, confirmationToken: token }),
                ).then(() => {
                  setMergeSource('');
                  setMergeTarget('');
                })
              }
              style={primaryBtn}
            >
              Merge
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid #e0e0e0',
  fontSize: '14px',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  border: 'none',
  background: '#4f46e5',
  color: '#fff',
  fontSize: '14px',
  cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '4px',
  border: '1px solid #e0e0e0',
  background: '#fff',
  fontSize: '12px',
  cursor: 'pointer',
};

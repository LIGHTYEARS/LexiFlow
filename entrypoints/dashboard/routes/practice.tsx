import React, { useCallback, useState } from 'react';
import { callMessage } from '@shared/ui/use-message';
import { ERROR_TYPES, type ErrorType } from '@domain/error/error.model';
import type { FsrsImpactPreview } from '@shared/protocol/protocol-map';

/**
 * Practice route (PRD §12.5, §19.6).
 *
 * Flow: choose a source (difficult / errors / manual card ids) and a practice
 * type → generate a session → load the generated items (practice/getSession) →
 * answer each item (choices rendered for multiple-choice) → record the attempt
 * (practice/recordAttempt) and reveal the explanation → optionally preview +
 * confirm FSRS impact (opt-in; gated by settings.review.allowPracticeAffectsFsrs
 * on the backend, which surfaces as PERMISSION_DENIED and is handled gracefully).
 *
 * Messages used: practice/generate, practice/getSession, practice/recordAttempt,
 * practice/previewFsrsImpact, practice/commitFsrsImpact.
 */

type SourceType = 'difficult' | 'errors' | 'manual';

const PRACTICE_TYPES = [
  'zh-to-en',
  'en-to-zh',
  'cloze',
  'multiple-choice',
  'synonym-distinction',
  'imitation',
  'term-explanation',
  'error-replay',
] as const;
type PracticeType = (typeof PRACTICE_TYPES)[number];

const OUTCOMES = ['correct', 'incorrect', 'partial', 'skipped'] as const;
type Outcome = (typeof OUTCOMES)[number];

const RATINGS = ['again', 'hard', 'good', 'easy'] as const;
type Rating = (typeof RATINGS)[number];

const ERROR_TYPE_LABEL: Record<ErrorType, string> = {
  forgot_meaning: 'Forgot meaning',
  recognized_but_cannot_use: 'Recognized but cannot use',
  collocation_error: 'Collocation error',
  confused_with_similar: 'Confused with similar item',
  register_inappropriate: 'Register inappropriate',
  context_inappropriate: 'Context inappropriate',
};

type PracticeSource =
  | { type: 'errors'; errorTypes?: string[] }
  | { type: 'difficult' }
  | { type: 'tag'; tagId: string }
  | { type: 'manual'; cardIds: string[] };

interface GenerateResult {
  sessionId: string;
  itemCount: number;
}

interface PracticeItem {
  itemId: string;
  type: string;
  prompt: string;
  explanation?: string;
  choices?: string[];
}

interface ItemState {
  answer: string;
  outcome: Outcome;
  rating: Rating | '';
  recording: boolean;
  attemptId?: string;
  explanation?: string;
  error?: string;
}

type FsrsPreviewResult = FsrsImpactPreview & { confirmationToken?: string };

const cardStyle: React.CSSProperties = {
  border: '1px solid #eee',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '16px',
  background: '#fff',
};

const btnBase: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: '#4f46e5',
  color: '#fff',
  borderColor: '#4f46e5',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: '6px',
  border: '1px solid #d1d5db',
  fontSize: '13px',
};

function newItemState(): ItemState {
  return { answer: '', outcome: 'correct', rating: '', recording: false };
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function Practice(): React.JSX.Element {
  // ── Source + type selection ──
  const [sourceType, setSourceType] = useState<SourceType>('difficult');
  const [errorTypeFilter, setErrorTypeFilter] = useState<ErrorType[]>([]);
  const [manualIds, setManualIds] = useState('');
  const [practiceType, setPracticeType] = useState<PracticeType>('cloze');

  const [generating, setGenerating] = useState(false);
  const [session, setSession] = useState<GenerateResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  // ── Generated items + per-item attempt state ──
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [attemptIds, setAttemptIds] = useState<string[]>([]);

  // ── FSRS impact opt-in flow ──
  const [preview, setPreview] = useState<FsrsPreviewResult | undefined>();
  const [previewing, setPreviewing] = useState(false);
  const [fsrsMessage, setFsrsMessage] = useState<string | undefined>();
  const [fsrsDisabled, setFsrsDisabled] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);

  const buildSource = useCallback((): PracticeSource => {
    switch (sourceType) {
      case 'errors':
        return errorTypeFilter.length > 0
          ? { type: 'errors', errorTypes: errorTypeFilter }
          : { type: 'errors' };
      case 'manual':
        return {
          type: 'manual',
          cardIds: manualIds
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        };
      case 'difficult':
      default:
        return { type: 'difficult' };
    }
  }, [sourceType, errorTypeFilter, manualIds]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(undefined);
    setSession(undefined);
    setItems([]);
    setItemStates({});
    setAttemptIds([]);
    setPreview(undefined);
    setFsrsMessage(undefined);
    setFsrsDisabled(false);
    setCommitted(false);
    try {
      const result = await callMessage<GenerateResult>('practice/generate', {
        source: buildSource(),
        practiceType,
      });
      setSession(result);
      if (result.itemCount > 0) {
        setLoadingItems(true);
        try {
          const loaded = await callMessage<{ items: PracticeItem[] }>('practice/getSession', {
            sessionId: result.sessionId,
          });
          setItems(loaded.items);
          const states: Record<string, ItemState> = {};
          for (const it of loaded.items) states[it.itemId] = newItemState();
          setItemStates(states);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load practice items');
        } finally {
          setLoadingItems(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate practice session');
    } finally {
      setGenerating(false);
    }
  }, [buildSource, practiceType]);

  const toggleErrorType = useCallback((t: ErrorType) => {
    setErrorTypeFilter((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }, []);

  const updateItemState = useCallback((itemId: string, patch: Partial<ItemState>) => {
    setItemStates((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }, []);

  const recordAttempt = useCallback(
    async (item: PracticeItem) => {
      const state = itemStates[item.itemId];
      if (!state) return;
      updateItemState(item.itemId, { recording: true, error: undefined });
      try {
        const res = await callMessage<{ attemptId: string }>('practice/recordAttempt', {
          itemId: item.itemId,
          userAnswer: state.answer,
          outcome: state.outcome,
          ...(state.rating ? { fsrsRating: state.rating } : {}),
        });
        setAttemptIds((prev) => [...prev, res.attemptId]);
        updateItemState(item.itemId, {
          recording: false,
          attemptId: res.attemptId,
          explanation: item.explanation,
        });
      } catch (e) {
        updateItemState(item.itemId, {
          recording: false,
          error: e instanceof Error ? e.message : 'Failed to record attempt',
        });
      }
    },
    [itemStates, updateItemState],
  );

  const previewImpact = useCallback(async () => {
    if (attemptIds.length === 0) return;
    setPreviewing(true);
    setFsrsMessage(undefined);
    setFsrsDisabled(false);
    try {
      const p = await callMessage<FsrsPreviewResult>('practice/previewFsrsImpact', {
        practiceAttemptIds: attemptIds,
      });
      setPreview(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to preview FSRS impact';
      // Backend returns PERMISSION_DENIED when the opt-in is off.
      if (/disabled|permission/i.test(msg)) {
        setFsrsDisabled(true);
        setFsrsMessage(
          'Practice does not affect your review schedule. Enable "Allow practice to affect FSRS" in Settings to opt in.',
        );
      } else {
        setFsrsMessage(msg);
      }
    } finally {
      setPreviewing(false);
    }
  }, [attemptIds]);

  const commitImpact = useCallback(async () => {
    if (!preview || !preview.confirmationToken) return;
    setCommitting(true);
    setFsrsMessage(undefined);
    try {
      await callMessage<{ committed: boolean }>('practice/commitFsrsImpact', {
        previewId: preview.previewId,
        confirmationToken: preview.confirmationToken,
      });
      setCommitted(true);
      setPreview(undefined);
    } catch (e) {
      setFsrsMessage(e instanceof Error ? e.message : 'Failed to apply FSRS impact');
    } finally {
      setCommitting(false);
    }
  }, [preview]);

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Practice</h2>
      <p style={{ color: '#666', marginTop: 0 }}>
        Generate targeted practice from your weak spots. Practice never changes your
        review schedule unless you explicitly opt in and confirm the impact.
      </p>

      {/* ── Source + type ── */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', marginTop: 0 }}>1. Choose a source</h3>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {(
            [
              ['difficult', 'Difficult cards'],
              ['errors', 'Recent errors'],
              ['manual', 'Specific card ids'],
            ] as const
          ).map(([val, label]) => (
            <label key={val} style={{ fontSize: '14px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="source"
                checked={sourceType === val}
                onChange={() => setSourceType(val)}
                style={{ marginRight: '6px' }}
              />
              {label}
            </label>
          ))}
        </div>

        {sourceType === 'errors' && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '6px' }}>
              Filter by error type (optional — leave empty for all):
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {ERROR_TYPES.map((t) => {
                const active = errorTypeFilter.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleErrorType(t)}
                    aria-pressed={active}
                    style={{
                      ...btnBase,
                      fontSize: '12px',
                      padding: '4px 10px',
                      background: active ? '#4f46e5' : '#fff',
                      color: active ? '#fff' : '#333',
                      borderColor: active ? '#4f46e5' : '#d1d5db',
                    }}
                  >
                    {ERROR_TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {sourceType === 'manual' && (
          <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '12px' }}>
            Card ids (comma or space separated):
            <input
              type="text"
              value={manualIds}
              onChange={(e) => setManualIds(e.target.value)}
              placeholder="card-id-1, card-id-2"
              style={{ ...inputStyle, display: 'block', width: '100%', maxWidth: '480px', marginTop: '4px' }}
            />
          </label>
        )}

        <h3 style={{ fontSize: '15px' }}>2. Choose a practice type</h3>
        <label style={{ fontSize: '13px', color: '#666' }}>
          Practice type:
          <select
            value={practiceType}
            onChange={(e) => setPracticeType(e.target.value as PracticeType)}
            style={{ ...inputStyle, display: 'block', marginTop: '4px', minWidth: '220px' }}
          >
            {PRACTICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div style={{ marginTop: '16px' }}>
          <button type="button" onClick={generate} disabled={generating} style={btnPrimary}>
            {generating ? 'Generating…' : 'Generate practice session'}
          </button>
        </div>
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      </div>

      {/* ── Session result ── */}
      {session && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: '15px', marginTop: 0 }}>Session created</h3>
          <p style={{ color: '#444' }}>
            Session <code>{session.sessionId}</code> with{' '}
            <strong>{session.itemCount}</strong> item{session.itemCount === 1 ? '' : 's'}.
          </p>
          {session.itemCount === 0 && (
            <p style={{ color: '#d97706' }}>
              No items matched this source. Try a different source or add more cards.
            </p>
          )}
          {loadingItems && <p style={{ color: '#666' }}>Loading items…</p>}
        </div>
      )}

      {/* ── Practice items ── */}
      {items.map((item, idx) => {
        const st = itemStates[item.itemId] ?? newItemState();
        const done = Boolean(st.attemptId);
        const isMultipleChoice =
          item.type === 'multiple-choice' && item.choices !== undefined && item.choices.length > 0;
        return (
          <div key={item.itemId} style={cardStyle}>
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
              Item {idx + 1} of {items.length} · {item.type}
            </div>
            <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '12px' }}>
              {item.prompt}
            </div>

            {/* Answer input */}
            {isMultipleChoice ? (
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={{ fontSize: '13px', color: '#666', marginBottom: '6px' }}>
                  Choose an answer
                </legend>
                {(item.choices ?? []).map((choice) => (
                  <label
                    key={choice}
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      marginBottom: '4px',
                      cursor: done ? 'default' : 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name={`choice-${item.itemId}`}
                      value={choice}
                      checked={st.answer === choice}
                      disabled={done}
                      onChange={() => updateItemState(item.itemId, { answer: choice })}
                      style={{ marginRight: '6px' }}
                    />
                    {choice}
                  </label>
                ))}
              </fieldset>
            ) : (
              <label style={{ display: 'block', fontSize: '13px', color: '#666' }}>
                Your answer
                <input
                  type="text"
                  value={st.answer}
                  disabled={done}
                  onChange={(e) => updateItemState(item.itemId, { answer: e.target.value })}
                  style={{ ...inputStyle, display: 'block', width: '100%', maxWidth: '480px', marginTop: '4px' }}
                />
              </label>
            )}

            {/* Outcome + rating + submit */}
            {!done && (
              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                  marginTop: '12px',
                }}
              >
                <label style={{ fontSize: '12px', color: '#666' }}>
                  Outcome
                  <select
                    value={st.outcome}
                    onChange={(e) => updateItemState(item.itemId, { outcome: e.target.value as Outcome })}
                    style={{ ...inputStyle, display: 'block', marginTop: '4px' }}
                  >
                    {OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: '12px', color: '#666' }}>
                  FSRS rating (optional)
                  <select
                    value={st.rating}
                    onChange={(e) => updateItemState(item.itemId, { rating: e.target.value as Rating | '' })}
                    style={{ ...inputStyle, display: 'block', marginTop: '4px' }}
                  >
                    <option value="">— none —</option>
                    {RATINGS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => recordAttempt(item)}
                  disabled={st.recording}
                  style={btnBase}
                >
                  {st.recording ? 'Recording…' : 'Submit answer'}
                </button>
              </div>
            )}

            {st.error && <p style={{ color: '#dc2626' }}>{st.error}</p>}

            {/* Explanation after attempt */}
            {done && (
              <div style={{ borderTop: '1px solid #eee', paddingTop: '12px', marginTop: '12px' }}>
                <p style={{ color: '#16a34a', margin: '0 0 8px' }}>Attempt recorded.</p>
                {st.explanation ? (
                  <div style={{ fontSize: '13px', color: '#444' }}>
                    <div style={{ fontSize: '12px', color: '#999' }}>Explanation</div>
                    {st.explanation}
                  </div>
                ) : (
                  <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>
                    No explanation provided for this item.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── FSRS impact opt-in ── */}
      {attemptIds.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: '15px', marginTop: 0 }}>
            Apply practice to review schedule (optional)
          </h3>
          <p style={{ fontSize: '13px', color: '#666' }}>
            {attemptIds.length} attempt{attemptIds.length === 1 ? '' : 's'} recorded. By
            default this practice does not change FSRS scheduling. If enabled in Settings,
            you can preview and confirm the impact before it is applied.
          </p>

          {committed && (
            <p style={{ color: '#16a34a' }}>FSRS impact applied to your schedule.</p>
          )}

          {!committed && !preview && (
            <button
              type="button"
              onClick={previewImpact}
              disabled={previewing || fsrsDisabled}
              style={btnBase}
            >
              {previewing ? 'Previewing…' : 'Preview FSRS impact'}
            </button>
          )}

          {fsrsMessage && (
            <p style={{ color: fsrsDisabled ? '#666' : '#dc2626', marginBottom: 0 }}>
              {fsrsMessage}
            </p>
          )}

          {preview && (
            <div style={{ marginTop: '12px' }}>
              <p style={{ fontSize: '13px', color: '#444' }}>{preview.summary}</p>
              <table style={{ borderCollapse: 'collapse', fontSize: '13px', width: '100%' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#666' }}>
                    <th style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>Card</th>
                    <th style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>Rating</th>
                    <th style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>Current due</th>
                    <th style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>New due</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.impacts.map((im) => (
                    <tr key={im.cardId}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>
                        <code>{im.cardId}</code>
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>
                        {im.rating}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>
                        {formatDue(im.currentDueAt)}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f5f5f5' }}>
                        {formatDue(im.newDueAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={commitImpact}
                  disabled={committing || !preview.confirmationToken}
                  style={btnPrimary}
                >
                  {committing ? 'Applying…' : 'Confirm and apply'}
                </button>
                <button type="button" onClick={() => setPreview(undefined)} style={btnBase}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

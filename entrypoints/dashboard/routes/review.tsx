import React, { useCallback, useState } from 'react';
import { callMessage } from '@shared/ui/use-message';
import { ERROR_TYPES, type ErrorType } from '@domain/error/error.model';
import type {
  ReviewSession,
  ReviewItem,
  ReviewReveal,
  ReviewRating,
  RatingPreview,
  ReviewCommitResult,
} from '@shared/protocol/protocol-map';

/**
 * Today Review route (PRD §6.3, §12.1–12.4, §19.5).
 *
 * Flow: create session → show due counts + grade legend → fetch next item →
 * show prompt → reveal answer + context → rate (with next-due preview hints) →
 * commit → optionally annotate error types → advance to next item.
 *
 * Messages used: review/createSession, review/next, review/reveal,
 * review/previewRating, review/commitRating, review/annotateError.
 */

const RATINGS: ReviewRating[] = ['again', 'hard', 'good', 'easy'];

const RATING_LABEL: Record<ReviewRating, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

const RATING_HELP: Record<ReviewRating, string> = {
  again: 'You could not recall it. The card is scheduled again very soon.',
  hard: 'You recalled it with significant difficulty. Shorter interval than Good.',
  good: 'You recalled it correctly with normal effort. The standard interval.',
  easy: 'You recalled it effortlessly. Longer interval than Good.',
};

const RATING_COLOR: Record<ReviewRating, string> = {
  again: '#dc2626',
  hard: '#d97706',
  good: '#4f46e5',
  easy: '#16a34a',
};

const ERROR_TYPE_LABEL: Record<ErrorType, string> = {
  forgot_meaning: 'Forgot meaning',
  recognized_but_cannot_use: 'Recognized but cannot use',
  collocation_error: 'Collocation error',
  confused_with_similar: 'Confused with similar item',
  register_inappropriate: 'Register inappropriate',
  context_inappropriate: 'Context inappropriate',
};

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = d.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (Math.abs(diffMin) < 60) return `${diffMin <= 0 ? 'now' : `in ${diffMin} min`}`;
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 48) return `in ${diffHr} h`;
  const diffDay = Math.round(diffHr / 24);
  return `in ${diffDay} d (${d.toLocaleDateString()})`;
}

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

export default function Review(): React.JSX.Element {
  const [session, setSession] = useState<ReviewSession | undefined>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [item, setItem] = useState<ReviewItem | null | undefined>();
  const [loadingItem, setLoadingItem] = useState(false);

  const [reveal, setReveal] = useState<ReviewReveal | undefined>();
  const [previews, setPreviews] = useState<Partial<Record<ReviewRating, RatingPreview>>>({});
  const [committing, setCommitting] = useState(false);

  const [committed, setCommitted] = useState<ReviewCommitResult | undefined>();
  const [selectedErrors, setSelectedErrors] = useState<ErrorType[]>([]);
  const [errorNote, setErrorNote] = useState('');
  const [annotateState, setAnnotateState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [reviewedCount, setReviewedCount] = useState(0);

  const loadNext = useCallback(async (sessionId: string) => {
    setLoadingItem(true);
    setError(undefined);
    setReveal(undefined);
    setPreviews({});
    setCommitted(undefined);
    setSelectedErrors([]);
    setErrorNote('');
    setAnnotateState('idle');
    try {
      const next = await callMessage<ReviewItem | null>('review/next', { sessionId });
      setItem(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load next item');
    } finally {
      setLoadingItem(false);
    }
  }, []);

  const startSession = useCallback(async () => {
    setStarting(true);
    setError(undefined);
    try {
      const s = await callMessage<ReviewSession>('review/createSession', {});
      setSession(s);
      setReviewedCount(0);
      await loadNext(s.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create review session');
    } finally {
      setStarting(false);
    }
  }, [loadNext]);

  const doReveal = useCallback(async () => {
    if (!session || !item) return;
    setError(undefined);
    try {
      const r = await callMessage<ReviewReveal>('review/reveal', {
        sessionId: session.sessionId,
        cardId: item.cardId,
        attemptId: item.attemptId,
      });
      setReveal(r);
      // Fetch next-due preview hints for all four grades in parallel.
      const results = await Promise.allSettled(
        RATINGS.map((rating) =>
          callMessage<RatingPreview>('review/previewRating', {
            attemptId: item.attemptId,
            rating,
          }),
        ),
      );
      const map: Partial<Record<ReviewRating, RatingPreview>> = {};
      results.forEach((res, i) => {
        if (res.status === 'fulfilled') map[RATINGS[i]] = res.value;
      });
      setPreviews(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reveal answer');
    }
  }, [session, item]);

  const commit = useCallback(
    async (rating: ReviewRating) => {
      if (!item) return;
      setCommitting(true);
      setError(undefined);
      try {
        const result = await callMessage<ReviewCommitResult>('review/commitRating', {
          attemptId: item.attemptId,
          rating,
          // No client-facing message returns the card's current schedule
          // sequence, so we send 0. This succeeds for cards with no prior
          // snapshot; a CONFLICT surfaces if the card was reviewed elsewhere.
          expectedSequence: 0,
        });
        setCommitted(result);
        setReviewedCount((n) => n + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to record rating');
      } finally {
        setCommitting(false);
      }
    },
    [item],
  );

  const toggleErrorType = useCallback((t: ErrorType) => {
    setSelectedErrors((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }, []);

  const saveAnnotation = useCallback(async () => {
    if (!committed) return;
    setAnnotateState('saving');
    setError(undefined);
    try {
      await callMessage<{ annotated: boolean }>('review/annotateError', {
        eventId: committed.eventId,
        confirmedTypes: selectedErrors,
        note: errorNote.trim() || undefined,
      });
      setAnnotateState('saved');
    } catch (e) {
      setAnnotateState('idle');
      setError(e instanceof Error ? e.message : 'Failed to save error annotation');
    }
  }, [committed, selectedErrors, errorNote]);

  // ── Start screen ──
  if (!session) {
    return (
      <div>
        <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Today Review</h2>
        <div style={cardStyle}>
          <p style={{ marginTop: 0, color: '#444' }}>
            Reviews use the FSRS spaced-repetition schedule. After you see the answer,
            rate how well you recalled it. Your grade sets the next review interval:
          </p>
          <ul style={{ color: '#444', lineHeight: 1.7, paddingLeft: '20px' }}>
            {RATINGS.map((r) => (
              <li key={r}>
                <strong style={{ color: RATING_COLOR[r] }}>{RATING_LABEL[r]}</strong>{' '}
                — {RATING_HELP[r]}
              </li>
            ))}
          </ul>
        </div>
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
        <button
          type="button"
          onClick={startSession}
          disabled={starting}
          style={{ ...btnBase, background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' }}
        >
          {starting ? 'Starting…' : 'Start review session'}
        </button>
      </div>
    );
  }

  const { dueCounts } = session;
  const totalDue = dueCounts.overdue + dueCounts.due + dueCounts.learning + dueCounts.new;

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Today Review</h2>

      {/* Due counts */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(
          [
            ['Overdue', dueCounts.overdue, '#dc2626'],
            ['Due', dueCounts.due, '#4f46e5'],
            ['Learning', dueCounts.learning, '#d97706'],
            ['New', dueCounts.new, '#16a34a'],
          ] as const
        ).map(([label, count, color]) => (
          <div
            key={label}
            style={{
              border: '1px solid #eee',
              borderRadius: '8px',
              padding: '10px 16px',
              minWidth: '80px',
              textAlign: 'center',
              background: '#fff',
            }}
          >
            <div style={{ fontSize: '22px', fontWeight: 600, color }}>{count}</div>
            <div style={{ fontSize: '12px', color: '#666' }}>{label}</div>
          </div>
        ))}
        <div style={{ fontSize: '12px', color: '#666', alignSelf: 'flex-end', paddingBottom: '6px' }}>
          Reviewed this session: {reviewedCount}
        </div>
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {loadingItem && <p style={{ color: '#666' }}>Loading next item…</p>}

      {/* Session complete */}
      {!loadingItem && item === null && (
        <div style={cardStyle}>
          <p style={{ margin: 0, color: '#444' }}>
            {totalDue === 0
              ? 'Nothing is due right now. You are all caught up.'
              : 'No more items in this session. Great work!'}
          </p>
          <button
            type="button"
            onClick={startSession}
            style={{ ...btnBase, marginTop: '12px' }}
          >
            Start a new session
          </button>
        </div>
      )}

      {/* Active item */}
      {!loadingItem && item && (
        <div style={cardStyle}>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
            Mode: {item.mode}
          </div>
          <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '16px' }}>
            {item.prompt}
          </div>

          {!reveal && !committed && (
            <button
              type="button"
              onClick={doReveal}
              style={{ ...btnBase, background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' }}
            >
              Show answer
            </button>
          )}

          {reveal && (
            <div>
              <div
                style={{
                  borderTop: '1px solid #eee',
                  paddingTop: '12px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#999' }}>Answer</div>
                <div style={{ fontSize: '16px', fontWeight: 500 }}>{reveal.answer}</div>
              </div>
              {reveal.context && (
                <div style={{ fontSize: '13px', color: '#555', marginBottom: '16px' }}>
                  {reveal.context.sentenceContaining && (
                    <p style={{ margin: '4px 0' }}>“{reveal.context.sentenceContaining}”</p>
                  )}
                  {reveal.context.paragraphExcerpt && (
                    <p style={{ margin: '4px 0', color: '#777' }}>
                      {reveal.context.paragraphExcerpt}
                    </p>
                  )}
                  {(reveal.context.pageTitle || reveal.context.url) && (
                    <p style={{ margin: '4px 0', color: '#999', fontSize: '12px' }}>
                      Source: {reveal.context.pageTitle || reveal.context.url}
                    </p>
                  )}
                </div>
              )}

              {/* Rating buttons with next-due preview hints */}
              {!committed && (
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {RATINGS.map((r) => {
                    const p = previews[r];
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => commit(r)}
                        disabled={committing}
                        style={{
                          ...btnBase,
                          borderColor: RATING_COLOR[r],
                          color: RATING_COLOR[r],
                          minWidth: '92px',
                          textAlign: 'center',
                          opacity: committing ? 0.6 : 1,
                        }}
                        title={RATING_HELP[r]}
                      >
                        <div style={{ fontWeight: 600 }}>{RATING_LABEL[r]}</div>
                        <div style={{ fontSize: '11px', color: '#888' }}>
                          {p ? formatDue(p.nextDueAt) : '…'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Post-commit: error annotation + advance */}
          {committed && (
            <div style={{ borderTop: '1px solid #eee', paddingTop: '12px', marginTop: '12px' }}>
              <p style={{ color: '#16a34a', margin: '0 0 12px' }}>
                Recorded. Next review {formatDue(committed.nextDueAt)} · state: {committed.state}
              </p>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Tag error types (optional)
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  {ERROR_TYPES.map((t) => {
                    const active = selectedErrors.includes(t);
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
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  Note (optional)
                  <input
                    type="text"
                    value={errorNote}
                    onChange={(e) => setErrorNote(e.target.value)}
                    placeholder="Why did this go wrong?"
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: '420px',
                      marginTop: '4px',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '13px',
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={saveAnnotation}
                  disabled={annotateState === 'saving'}
                  style={{ ...btnBase, fontSize: '13px', padding: '6px 12px', marginTop: '8px' }}
                >
                  {annotateState === 'saving'
                    ? 'Saving…'
                    : annotateState === 'saved'
                      ? 'Saved ✓'
                      : 'Save error tags'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => session && loadNext(session.sessionId)}
                style={{
                  ...btnBase,
                  background: '#4f46e5',
                  color: '#fff',
                  borderColor: '#4f46e5',
                }}
              >
                Next item
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

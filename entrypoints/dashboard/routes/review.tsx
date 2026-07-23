import React, { useState, useEffect, useCallback } from 'react';

interface ReviewItem {
  attemptId: string;
  cardId: string;
  prompt: string;
  mode: string;
}

interface ReviewReveal {
  attemptId: string;
  answer: string;
  context?: {
    sentenceContaining?: string;
    pageTitle?: string;
    url?: string;
  };
}

const CARD_STYLE: React.CSSProperties = {
  padding: '24px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  background: '#fff',
  marginBottom: '16px',
  minHeight: '200px',
};

const RATING_BUTTON_STYLE: React.CSSProperties = {
  padding: '12px 24px',
  borderRadius: '6px',
  border: 'none',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  flex: 1,
};

export default function Review(): React.JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentItem, setCurrentItem] = useState<ReviewItem | null>(null);
  const [reveal, setReveal] = useState<ReviewReveal | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [status, setStatus] = useState('');

  const startSession = useCallback(async () => {
    setLoading(true);
    setSessionComplete(false);
    setReveal(null);
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'review/createSession',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        setSessionId(res.data.sessionId);
        setStatus(`Session started: ${res.data.dueCounts.overdue} overdue, ${res.data.dueCounts.due} due, ${res.data.dueCounts.new} new`);
        await loadNext(res.data.sessionId);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNext = useCallback(async (sid: string) => {
    setLoading(true);
    setReveal(null);
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'review/next',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { sessionId: sid },
      });
      if (res?.ok) {
        if (res.data === null) {
          setSessionComplete(true);
          setCurrentItem(null);
        } else {
          setCurrentItem(res.data);
        }
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReveal = useCallback(async () => {
    if (!sessionId || !currentItem) return;
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'review/reveal',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          sessionId,
          cardId: currentItem.cardId,
          attemptId: currentItem.attemptId,
        },
      });
      if (res?.ok) {
        setReveal(res.data);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    }
  }, [sessionId, currentItem]);

  const handleRating = useCallback(async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!sessionId || !currentItem) return;
    setStatus('Recording...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'review/commitRating',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          attemptId: currentItem.attemptId,
          rating,
          expectedSequence: 0,
        },
      });
      if (res?.ok) {
        setStatus(`Next review: ${new Date(res.data.nextDueAt).toLocaleDateString()}`);
        await loadNext(sessionId);
      } else {
        setStatus('Error: ' + (res?.error?.userMessage || 'unknown'));
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    }
  }, [sessionId, currentItem, loadNext]);

  useEffect(() => {
    startSession();
  }, [startSession]);

  if (loading && !currentItem) {
    return <div style={{ padding: '24px' }}>Loading review session...</div>;
  }

  if (sessionComplete) {
    return (
      <div style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Review Complete!</h2>
        <p style={{ color: '#666', marginBottom: '16px' }}>You've finished all cards in this session.</p>
        <button style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer' }} onClick={startSession}>
          Start New Session
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '600px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Today Review</h2>
      {status && (
        <div style={{ padding: '8px 12px', background: '#f0fdf4', color: '#166534', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
          {status}
        </div>
      )}
      {currentItem && (
        <>
          <div style={CARD_STYLE}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
              Recall the meaning:
            </div>
            <div style={{ fontSize: '24px', fontWeight: 600, marginBottom: '16px' }}>
              {currentItem.prompt}
            </div>
            {!reveal ? (
              <button
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
                onClick={handleReveal}
              >
                Show Answer
              </button>
            ) : (
              <div>
                <div style={{ fontSize: '14px', color: '#374151', marginBottom: '8px' }}>
                  <strong>Answer:</strong> {reveal.answer}
                </div>
                {reveal.context?.sentenceContaining && (
                  <div style={{ fontSize: '13px', color: '#6b7280', fontStyle: 'italic', marginBottom: '8px' }}>
                    "{reveal.context.sentenceContaining}"
                  </div>
                )}
                {reveal.context?.pageTitle && (
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                    From: {reveal.context.pageTitle}
                  </div>
                )}
              </div>
            )}
          </div>
          {reveal && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{ ...RATING_BUTTON_STYLE, background: '#dc2626', color: '#fff' }} onClick={() => handleRating('again')}>
                Again
              </button>
              <button style={{ ...RATING_BUTTON_STYLE, background: '#f59e0b', color: '#fff' }} onClick={() => handleRating('hard')}>
                Hard
              </button>
              <button style={{ ...RATING_BUTTON_STYLE, background: '#10b981', color: '#fff' }} onClick={() => handleRating('good')}>
                Good
              </button>
              <button style={{ ...RATING_BUTTON_STYLE, background: '#3b82f6', color: '#fff' }} onClick={() => handleRating('easy')}>
                Easy
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callMessage } from '@shared/ui/use-message';
import { ERROR_TYPES, type ErrorType } from '@domain/error/error.model';

/**
 * Errors route (PRD §12.4, §12.5).
 *
 * There is no dedicated read message (e.g. 'errors/list') in the protocol map,
 * so this page does not fabricate one. Instead it explains how error tracking
 * works and lets the user launch targeted practice built from their recent
 * errors — the actionable path the error data feeds into.
 *
 * Messages used: practice/generate (source { type: 'errors' }).
 * Limitation: recent error annotations cannot be listed here until a read
 * message exists; the UI is a practice-entry point plus a clear explanation.
 */

const ERROR_TYPE_DETAIL: Record<ErrorType, string> = {
  forgot_meaning: 'You could not recall what the item means.',
  recognized_but_cannot_use: 'You knew it passively but could not produce it.',
  collocation_error: 'Wrong word combination or partner word.',
  confused_with_similar: 'Mixed up with a similar-looking or similar-meaning item.',
  register_inappropriate: 'Right meaning, wrong formality or tone.',
  context_inappropriate: 'Used in a situation where it does not fit.',
};

const ERROR_TYPE_LABEL: Record<ErrorType, string> = {
  forgot_meaning: 'Forgot meaning',
  recognized_but_cannot_use: 'Recognized but cannot use',
  collocation_error: 'Collocation error',
  confused_with_similar: 'Confused with similar item',
  register_inappropriate: 'Register inappropriate',
  context_inappropriate: 'Context inappropriate',
};

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

export default function Errors(): React.JSX.Element {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<ErrorType[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ sessionId: string; itemCount: number } | undefined>();
  const [error, setError] = useState<string | undefined>();

  const toggle = useCallback((t: ErrorType) => {
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }, []);

  const startPractice = useCallback(async () => {
    setGenerating(true);
    setError(undefined);
    setResult(undefined);
    try {
      const source =
        selected.length > 0
          ? { type: 'errors' as const, errorTypes: selected }
          : { type: 'errors' as const };
      const res = await callMessage<{ sessionId: string; itemCount: number }>(
        'practice/generate',
        { source, practiceType: 'error-replay' },
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate practice from errors');
    } finally {
      setGenerating(false);
    }
  }, [selected]);

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Errors</h2>

      <div style={cardStyle}>
        <p style={{ marginTop: 0, color: '#444' }}>
          When you rate a review <strong>Again</strong> or <strong>Hard</strong>, LexiFlow
          records it as an error and lets you tag <em>why</em> it went wrong. These error
          types feed targeted practice so you can drill your weak spots.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {ERROR_TYPES.map((t) => (
            <div
              key={t}
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: '6px',
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600 }}>{ERROR_TYPE_LABEL[t]}</div>
              <div style={{ fontSize: '12px', color: '#777' }}>{ERROR_TYPE_DETAIL[t]}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', marginTop: 0 }}>Start targeted practice from errors</h3>
        <p style={{ fontSize: '13px', color: '#666' }}>
          Optionally focus on specific error types (leave all unselected to include every
          recent error):
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {ERROR_TYPES.map((t) => {
            const active = selected.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
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

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={startPractice}
            disabled={generating}
            style={{ ...btnBase, background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' }}
          >
            {generating ? 'Generating…' : 'Generate error-replay practice'}
          </button>
          <button type="button" onClick={() => navigate('/practice')} style={btnBase}>
            Open full Practice builder
          </button>
        </div>

        {error && <p style={{ color: '#dc2626' }}>{error}</p>}

        {result && (
          <div style={{ marginTop: '14px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
            {result.itemCount > 0 ? (
              <p style={{ color: '#16a34a', margin: 0 }}>
                Created a practice session with <strong>{result.itemCount}</strong> item
                {result.itemCount === 1 ? '' : 's'} from your errors. Continue in the{' '}
                <button
                  type="button"
                  onClick={() => navigate('/practice')}
                  style={{
                    ...btnBase,
                    padding: '2px 8px',
                    fontSize: '13px',
                    display: 'inline',
                  }}
                >
                  Practice
                </button>{' '}
                tab.
              </p>
            ) : (
              <p style={{ color: '#d97706', margin: 0 }}>
                No recent errors matched. Review some cards and tag errors first, then come
                back to practice them.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

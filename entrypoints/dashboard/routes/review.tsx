import React, { useState, useEffect } from 'react';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';
import type {
  DashboardCounts,
  ReviewSession,
  CreateReviewSessionCommand,
} from '@shared/protocol/protocol-map';

type StatusState = {
  type: 'idle' | 'success' | 'error';
  message: string;
};

export default function Review(): React.JSX.Element {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<StatusState>({ type: 'idle', message: '' });

  useEffect(() => {
    void loadCounts();
  }, []);

  async function loadCounts(): Promise<void> {
    try {
      const result = await sendMessage<AppResult<DashboardCounts>>('dashboard/counts');
      if (result.ok) {
        setCounts(result.data);
      } else {
        setStatus({ type: 'error', message: result.error.userMessage });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to load review counts.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleStartReview(): Promise<void> {
    setStarting(true);
    setStatus({ type: 'idle', message: '' });
    try {
      const payload: CreateReviewSessionCommand = {};
      const result = await sendMessage<AppResult<ReviewSession>>(
        'review/createSession',
        payload,
      );
      if (result.ok) {
        setSession(result.data);
        const totalDue = result.data.dueCounts.due + result.data.dueCounts.overdue;
        setStatus({
          type: 'success',
          message: `Review session created with ${totalDue} cards due.`,
        });
      } else {
        setStatus({ type: 'error', message: 'Review sessions are not available yet.' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Review sessions are not available yet.' });
    } finally {
      setStarting(false);
    }
  }

  const statStyle: React.CSSProperties = {
    padding: '12px 16px',
    background: '#f5f5f5',
    borderRadius: '8px',
    minWidth: '100px',
  };

  const statLabelStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#666',
    margin: 0,
  };

  const statValueStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 600,
    margin: 0,
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    background: starting ? '#9ca3af' : '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: starting ? 'not-allowed' : 'pointer',
    fontSize: '14px',
  };

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Today's Review</h2>

      {counts && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
          <div style={statStyle}>
            <p style={statLabelStyle}>Due today</p>
            <p style={statValueStyle}>{counts.todayDue}</p>
          </div>
          <div style={statStyle}>
            <p style={statLabelStyle}>Overdue</p>
            <p style={statValueStyle}>{counts.overdue}</p>
          </div>
          <div style={statStyle}>
            <p style={statLabelStyle}>New this week</p>
            <p style={statValueStyle}>{counts.newThisWeek}</p>
          </div>
        </div>
      )}

      {loading && (
        <p style={{ color: '#999', fontSize: '14px' }}>Loading counts…</p>
      )}

      <button
        onClick={handleStartReview}
        disabled={starting}
        style={buttonStyle}
      >
        {starting ? 'Starting…' : 'Start Review'}
      </button>

      {session && (
        <p style={{ fontSize: '13px', color: '#666', marginTop: '12px' }}>
          Session: {session.sessionId.slice(0, 8)}…
        </p>
      )}

      {status.type !== 'idle' && (
        <p
          style={{
            color: status.type === 'success' ? '#16a34a' : '#dc2626',
            fontSize: '14px',
            marginTop: '12px',
          }}
        >
          {status.message}
        </p>
      )}
    </div>
  );
}

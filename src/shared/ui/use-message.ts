import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';

/**
 * Shared messaging helpers for extension pages (popup, sidepanel, dashboard).
 * Wraps the typed sendMessage transport and unwraps AppResult.
 */

/**
 * Call a background message once and return the data, throwing on error.
 */
export async function callMessage<T>(type: string, payload?: unknown): Promise<T> {
  const res = (await sendMessage<AppResult<T>>(type, payload ?? null)) as AppResult<T>;
  if (!res || typeof res !== 'object' || !('ok' in res)) {
    throw new Error('Malformed response');
  }
  if (!res.ok) throw new Error(res.error.userMessage);
  return res.data;
}

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
}

/**
 * useQuery — fetch data from the background on mount and expose reload.
 * `deps` re-runs the query when changed.
 */
export function useQuery<T>(
  type: string,
  payload?: unknown,
  deps: unknown[] = [],
): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const run = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    callMessage<T>(type, payloadRef.current)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Request failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  const [nonce, setNonce] = useState(0);
  useEffect(() => run(), [run, nonce, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

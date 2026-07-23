import React, { useEffect, useState, useCallback } from 'react';
import { useQuery, callMessage } from '@shared/ui/use-message';
import type { DashboardCounts } from '@shared/protocol/protocol-map';

/**
 * Popup — quick entry (PRD §5.3): today due, overdue, Inbox count, new this
 * week, common actions, plus enabling LexiFlow on the current site.
 *
 * Enabling a site requires chrome.permissions.request, which must run inside a
 * user gesture in the popup's own context — so the popup requests the origin
 * permission directly, then asks the background to register + inject the
 * content script (which is why the selection trigger appears without a reload).
 */
export default function App(): React.JSX.Element {
  const { data, loading, error } = useQuery<DashboardCounts>('dashboard/counts');
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [siteEnabled, setSiteEnabled] = useState<boolean | null>(null);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteMsg, setSiteMsg] = useState<string | undefined>();

  const supported = !!tab?.url && /^https?:\/\//.test(tab.url);

  const refreshAccess = useCallback(async (url: string) => {
    try {
      const res = await callMessage<{ enabled: boolean }>('page/check-access', { url });
      setSiteEnabled(res.enabled);
    } catch {
      setSiteEnabled(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(active ?? null);
      if (active?.url && /^https?:\/\//.test(active.url)) {
        await refreshAccess(active.url);
      } else {
        setSiteEnabled(false);
      }
    })();
  }, [refreshAccess]);

  const originPatternOf = (url: string): string | null => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return `${u.protocol}//${u.host}/*`;
    } catch {
      return null;
    }
  };

  const enableSite = async () => {
    if (!tab?.url || !tab.id) return;
    const pattern = originPatternOf(tab.url);
    if (!pattern) {
      setSiteMsg('This page type is not supported.');
      return;
    }
    setSiteBusy(true);
    setSiteMsg(undefined);
    try {
      // User gesture: request the origin permission here in the popup.
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        setSiteMsg('Permission was declined.');
        return;
      }
      // Register for future loads via the background (persists across the
      // session); tolerate a sleeping worker.
      try {
        await callMessage('page/register-site', { url: tab.url });
      } catch {
        /* background may be asleep; the direct injection below is what matters now */
      }
      // Inject immediately from the popup itself — the popup has the scripting
      // permission and just acquired the host permission in this gesture, so we
      // don't depend on a live background service worker.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: ['content-scripts/content.js'],
      });
      setSiteEnabled(true);
      setSiteMsg('Enabled — select text on the page to see the trigger.');
    } catch (e) {
      setSiteMsg(e instanceof Error ? e.message : 'Could not enable this site.');
    } finally {
      setSiteBusy(false);
    }
  };

  const disableSite = async () => {
    if (!tab?.url) return;
    const pattern = originPatternOf(tab.url);
    if (!pattern) return;
    setSiteBusy(true);
    setSiteMsg(undefined);
    try {
      await chrome.permissions.remove({ origins: [pattern] });
      await callMessage('page/disable-site', { url: tab.url });
      setSiteEnabled(false);
      setSiteMsg('Disabled on this site.');
    } catch (e) {
      setSiteMsg(e instanceof Error ? e.message : 'Could not disable this site.');
    } finally {
      setSiteBusy(false);
    }
  };

  const open = (destination: string) => {
    void callMessage('navigation/open', { destination });
    window.close();
  };

  return (
    <div
      style={{
        width: '320px',
        minHeight: '360px',
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '18px', marginBottom: '16px' }}>LexiFlow</h1>

      {/* Current-site enablement */}
      <div style={{ marginBottom: '16px', padding: '10px', borderRadius: '8px', background: '#f5f5f5' }}>
        {!supported ? (
          <div style={{ fontSize: '13px', color: '#666' }}>LexiFlow can’t run on this page.</div>
        ) : siteEnabled === null ? (
          <div style={{ fontSize: '13px', color: '#666' }}>Checking site…</div>
        ) : siteEnabled ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', color: '#059669' }}>● Enabled on this site</span>
            <button type="button" onClick={disableSite} disabled={siteBusy} style={ghostBtn}>
              Disable
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', color: '#666' }}>Not enabled here</span>
            <button type="button" onClick={enableSite} disabled={siteBusy} style={{ ...primaryBtnSmall }}>
              {siteBusy ? 'Enabling…' : 'Enable on this site'}
            </button>
          </div>
        )}
        {siteMsg && <div style={{ fontSize: '12px', color: '#555', marginTop: '6px' }}>{siteMsg}</div>}
      </div>

      {loading && <p style={{ color: '#666', fontSize: '14px' }}>Loading…</p>}
      {error && <p style={{ color: '#dc2626', fontSize: '13px' }}>{error}</p>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <Stat label="Due today" value={data.todayDue} />
          <Stat label="Overdue" value={data.overdue} highlight={data.overdue > 0} />
          <Stat label="Inbox" value={data.inbox} />
          <Stat label="New this week" value={data.newThisWeek} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <ActionButton primary onClick={() => open('review')}>Start today review</ActionButton>
        <ActionButton onClick={() => open('inbox')}>Open Inbox</ActionButton>
        <ActionButton onClick={() => open('dashboard')}>Open Dashboard</ActionButton>
        <ActionButton onClick={() => open('settings')}>Settings</ActionButton>
      </div>

      <p style={{ color: '#999', fontSize: '12px', marginTop: '12px' }}>v0.1.0</p>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }): React.JSX.Element {
  return (
    <div style={{ padding: '10px', borderRadius: '8px', background: highlight ? '#fef2f2' : '#f5f5f5' }}>
      <div style={{ fontSize: '22px', fontWeight: 600, color: highlight ? '#dc2626' : '#111' }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#666' }}>{label}</div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 12px',
        borderRadius: '8px',
        border: primary ? 'none' : '1px solid #e0e0e0',
        background: primary ? '#4f46e5' : '#fff',
        color: primary ? '#fff' : '#333',
        fontSize: '14px',
        fontWeight: primary ? 600 : 400,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {children}
    </button>
  );
}

const primaryBtnSmall: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: 'none',
  background: '#4f46e5',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid #e0e0e0',
  background: '#fff',
  color: '#333',
  fontSize: '13px',
  cursor: 'pointer',
};

import React, { useState, useEffect } from 'react';
import { sendMessage } from '@infra/messaging/browser-runtime';
import type { AppResult } from '@shared/protocol/envelope';
import type {
  UserSettingsView,
  SettingsUpdateCommand,
  ConnectionTestResult,
} from '@shared/protocol/protocol-map';
import type { UserSettings } from '@infra/storage/settings-schema';

const DEFAULT_PROFILE_ID = 'quick-explain';

type StatusState = {
  type: 'idle' | 'success' | 'error';
  message: string;
};

type ConnectionState = {
  type: 'idle' | 'testing' | 'success' | 'error';
  message: string;
};

export default function Settings(): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [hasCredential, setHasCredential] = useState(false);

  const [status, setStatus] = useState<StatusState>({ type: 'idle', message: '' });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>({
    type: 'idle',
    message: '',
  });
  const [saving, setSaving] = useState(false);

  const [pageAccessUrl, setPageAccessUrl] = useState('');
  const [pageAccessStatus, setPageAccessStatus] = useState('');
  const [pageAccessStatusType, setPageAccessStatusType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings(): Promise<void> {
    try {
      const result = await sendMessage<AppResult<UserSettingsView>>('settings/get');
      if (result.ok) {
        setBaseUrl(result.data.model.baseUrl || '');
        setHasCredential(result.data.model.hasCredential);
        setModelId(result.data.model.taskModels[DEFAULT_PROFILE_ID] || '');
      } else {
        setStatus({ type: 'error', message: result.error.userMessage });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to load settings.' });
    }
  }

  async function saveCurrentSettings(): Promise<boolean> {
    try {
      // Step 1: If a new API key was entered, save it as a credential first
      let credentialRef: string | undefined;
      if (apiKey) {
        const credResult = await sendMessage<
          AppResult<{ success: boolean; credentialRef?: string }>
        >('settings/saveCredential', {
          type: 'litellm-api-key',
          value: apiKey,
        });
        if (!credResult.ok || !credResult.data.success || !credResult.data.credentialRef) {
          setStatus({
            type: 'error',
            message: credResult.ok ? 'Failed to save API key.' : credResult.error.userMessage,
          });
          return false;
        }
        credentialRef = credResult.data.credentialRef;
      }

      // Step 2: Request model origin permission (requires user gesture)
      if (baseUrl) {
        const permResult = await sendMessage<
          AppResult<{ granted: boolean; originPattern?: string }>
        >('settings/requestModelAccess', { baseUrl });
        if (!permResult.ok || !permResult.data.granted) {
          setStatus({
            type: 'error',
            message: permResult.ok
              ? 'Permission for model origin was not granted.'
              : permResult.error.userMessage,
          });
          return false;
        }
      }

      // Step 3: Save settings with the credential reference (not the raw key)
      // IMPORTANT: Only include credentialRef if a new key was entered.
      // Otherwise, omit it so the deep merge in updateSettings preserves
      // the existing credentialRef (don't wipe it with undefined).
      const patch: Partial<UserSettings> = {
        model: {
          baseUrl,
          ...(credentialRef ? { credentialRef } : {}),
          taskModels: { [DEFAULT_PROFILE_ID]: modelId },
        },
      };
      const command: SettingsUpdateCommand = { patch };
      const result = await sendMessage<AppResult<{ updated: boolean }>>(
        'settings/update',
        command,
      );
      if (result.ok) {
        if (apiKey) {
          setHasCredential(true);
          setApiKey('');
        }
        return true;
      } else {
        setStatus({ type: 'error', message: result.error.userMessage });
        return false;
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to save settings.' });
      return false;
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setStatus({ type: 'idle', message: '' });
    const saved = await saveCurrentSettings();
    if (saved) {
      setStatus({ type: 'success', message: 'Settings saved successfully.' });
    }
    setSaving(false);
  }

  async function handleTestConnection(): Promise<void> {
    setConnectionStatus({ type: 'testing', message: 'Testing connection…' });

    // Save current form values first so the test uses them (not stale defaults)
    const saved = await saveCurrentSettings();
    if (!saved) {
      setConnectionStatus({
        type: 'error',
        message: status.message || 'Failed to save settings before testing.',
      });
      return;
    }

    try {
      const result = await sendMessage<AppResult<ConnectionTestResult>>(
        'aiTask/testConnection',
        { profileId: DEFAULT_PROFILE_ID },
      );
      if (result.ok) {
        if (result.data.ok) {
          const latency = result.data.latencyMs != null
            ? ` (${result.data.latencyMs}ms)`
            : '';
          setConnectionStatus({
            type: 'success',
            message: `Connection successful${latency}.`,
          });
        } else {
          setConnectionStatus({
            type: 'error',
            message: result.data.message || 'Connection failed.',
          });
        }
      } else {
        setConnectionStatus({ type: 'error', message: result.error.userMessage });
      }
    } catch {
      setConnectionStatus({ type: 'error', message: 'Failed to test connection.' });
    }
  }

  async function handleEnableUrl(): Promise<void> {
    if (!pageAccessUrl) return;
    setPageAccessStatus('Enabling…');
    try {
      const result = await sendMessage<
        AppResult<{ granted: boolean; originPattern: string }>
      >('page/enable-site', { url: pageAccessUrl });
      if (result.ok && result.data.granted) {
        setPageAccessStatusType('success');
        setPageAccessStatus('Enabled. Refresh pages on this origin to use LexiFlow.');
      } else {
        setPageAccessStatusType('error');
        setPageAccessStatus('Failed to enable. Check extension permissions.');
      }
    } catch {
      setPageAccessStatusType('error');
      setPageAccessStatus('Failed to enable.');
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '4px',
    fontSize: '14px',
    color: '#333',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  };

  const buttonDisabledStyle: React.CSSProperties = {
    ...buttonStyle,
    background: '#9ca3af',
    cursor: 'not-allowed',
  };

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Settings</h2>

      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px', color: '#333' }}>
          LiteLLM Connection
        </h3>

        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasCredential ? '•••••••• (already configured)' : 'Enter API key'}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Default Task Model ID</label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="gpt-4o, claude-3-5-sonnet, etc."
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            onClick={handleTestConnection}
            disabled={connectionStatus.type === 'testing'}
            style={connectionStatus.type === 'testing' ? buttonDisabledStyle : buttonStyle}
          >
            {connectionStatus.type === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={saving ? buttonDisabledStyle : buttonStyle}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>

        {connectionStatus.type !== 'idle' && (
          <p
            style={{
              color: connectionStatus.type === 'success' ? '#16a34a' : '#dc2626',
              fontSize: '14px',
              margin: '0 0 8px',
            }}
          >
            {connectionStatus.message}
          </p>
        )}

        {status.type !== 'idle' && (
          <p
            style={{
              color: status.type === 'success' ? '#16a34a' : '#dc2626',
              fontSize: '14px',
              margin: '0',
            }}
          >
            {status.message}
          </p>
        )}
      </div>

      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px', color: '#333' }}>
          Page Access
        </h3>
        <p style={{ fontSize: '14px', color: '#666', margin: '0 0 12px' }}>
          LexiFlow only works on pages you explicitly authorize. Enable the
          current page from the extension popup, or enter a URL pattern below.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            value={pageAccessUrl}
            onChange={(e) => setPageAccessUrl(e.target.value)}
            placeholder="https://en.wikipedia.org/*"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={handleEnableUrl}
            disabled={!pageAccessUrl}
            style={!pageAccessUrl ? buttonDisabledStyle : buttonStyle}
          >
            Enable
          </button>
        </div>
        {pageAccessStatus && (
          <p
            style={{
              color: pageAccessStatusType === 'success' ? '#16a34a' : '#dc2626',
              fontSize: '14px',
              margin: '0',
            }}
          >
            {pageAccessStatus}
          </p>
        )}
      </div>
    </div>
  );
}

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

  async function handleSave(): Promise<void> {
    setSaving(true);
    setStatus({ type: 'idle', message: '' });
    try {
      const patch: Partial<UserSettings> = {
        model: {
          baseUrl,
          credentialRef: apiKey || undefined,
          taskModels: { [DEFAULT_PROFILE_ID]: modelId },
        },
      };
      const command: SettingsUpdateCommand = { patch };
      const result = await sendMessage<AppResult<{ updated: boolean }>>(
        'settings/update',
        command,
      );
      if (result.ok) {
        setStatus({ type: 'success', message: 'Settings saved successfully.' });
        if (apiKey) {
          setHasCredential(true);
          setApiKey('');
        }
      } else {
        setStatus({ type: 'error', message: result.error.userMessage });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection(): Promise<void> {
    setConnectionStatus({ type: 'testing', message: 'Testing connection…' });
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
    </div>
  );
}

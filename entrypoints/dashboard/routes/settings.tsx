import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { UserSettingsView } from '@shared/protocol/protocol-map';

const SECTION_STYLE: React.CSSProperties = {
  marginBottom: '32px',
  padding: '20px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  background: '#fff',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#374151',
  marginBottom: '4px',
};

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: 'none',
  background: '#4f46e5',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
};

const DANGER_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  background: '#dc2626',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: '1px solid #f3f4f6',
};

export default function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<UserSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'settings/get',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        setSettings(res.data);
        setBaseUrl(res.data.model.baseUrl || '');
        setModelName(res.data.model.taskModels?.['default'] || '');
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSetting = useCallback(
    async (patch: Record<string, unknown>) => {
      setSaving(true);
      setStatus('');
      try {
        const res = await chrome.runtime.sendMessage({
          protocolVersion: 1,
          type: 'settings/update',
          requestId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: { patch },
        });
        if (res?.ok) {
          setStatus('Saved');
          await loadSettings();
          setTimeout(() => setStatus(''), 2000);
        } else {
          setStatus('Error: ' + (res?.error?.userMessage || 'unknown'));
        }
      } catch (e) {
        setStatus('Error: ' + String(e));
      } finally {
        setSaving(false);
      }
    },
    [loadSettings],
  );

  const saveCredential = useCallback(async () => {
    if (!apiKey.trim()) {
      setStatus('API key cannot be empty');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'settings/save-credential',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { value: apiKey },
      });
      if (res?.ok) {
        setStatus('Credential saved');
        setApiKey('');
        await loadSettings();
        setTimeout(() => setStatus(''), 2000);
      } else {
        setStatus('Error: ' + (res?.error?.userMessage || 'unknown'));
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, loadSettings]);

  const deleteCredential = useCallback(async () => {
    if (!confirm('Delete the stored API key?')) return;
    setSaving(true);
    setStatus('');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'settings/delete-credential',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        setStatus('Credential deleted');
        await loadSettings();
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, [loadSettings]);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult('');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'aiTask/testConnection',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: { profileId: 'default' },
      });
      if (res?.ok) {
        setTestResult(
          res.data.ok
            ? `✓ Connected (${res.data.latencyMs ?? '?'}ms)`
            : `✗ Failed: ${res.data.message}`,
        );
      } else {
        setTestResult('✗ Error: ' + (res?.error?.userMessage || 'unknown'));
      }
    } catch (e) {
      setTestResult('✗ Error: ' + String(e));
    } finally {
      setTesting(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    setFetchingModels(true);
    setAvailableModels([]);
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'aiTask/listModels',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        setAvailableModels(res.data.models || []);
      } else {
        setTestResult('✗ Failed to fetch models: ' + (res?.error?.userMessage || 'unknown'));
      }
    } catch (e) {
      setTestResult('✗ Error: ' + String(e));
    } finally {
      setFetchingModels(false);
    }
  }, []);

  const handleExportBackup = useCallback(async () => {
    setSaving(true);
    setStatus('Exporting...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'backup/export',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        const a = document.createElement('a');
        a.href = res.data.dataUrl;
        a.download = res.data.filename;
        a.click();
        setStatus('Backup exported');
        setTimeout(() => setStatus(''), 2000);
      } else {
        setStatus('Error: ' + (res?.error?.userMessage || 'unknown'));
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const handleImportBackup = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Import backup? This may replace existing data.')) {
      e.target.value = '';
      return;
    }
    setSaving(true);
    setStatus('Importing...');
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const res = await chrome.runtime.sendMessage({
          protocolVersion: 1,
          type: 'backup/import',
          requestId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payload: { dataUrl, replace: false },
        });
        if (res?.ok) {
          setStatus(`Imported ${res.data.recordCount} records from ${res.data.tables.length} tables`);
          setTimeout(() => setStatus(''), 3000);
        } else {
          setStatus('Error: ' + (res?.error?.userMessage || 'unknown'));
        }
        setSaving(false);
      };
      reader.readAsDataURL(file);
    } catch (e) {
      setStatus('Error: ' + String(e));
      setSaving(false);
    }
    e.target.value = '';
  }, []);

  const handleExportCsv = useCallback(async () => {
    setSaving(true);
    setStatus('Exporting CSV...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'backup/exportCsv',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        const blob = new Blob([res.data.csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus('CSV exported');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const handleExportMarkdown = useCallback(async () => {
    setSaving(true);
    setStatus('Exporting Markdown...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'backup/exportMarkdown',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        const blob = new Blob([res.data.markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        setStatus('Markdown exported');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const handleClearInbox = useCallback(async () => {
    if (!confirm('Clear all Inbox items? This cannot be undone.')) return;
    setSaving(true);
    setStatus('Clearing Inbox...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'data/clearInbox',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        setStatus(`Cleared ${res.data.cleared} items`);
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const handleClearAllData = useCallback(async () => {
    if (!confirm('WARNING: This will delete ALL data (cards, sources, inbox, review history). This cannot be undone. Continue?')) return;
    if (!confirm('Are you absolutely sure? Export a backup first if you want to keep your data.')) return;
    setSaving(true);
    setStatus('Clearing all data...');
    try {
      const res = await chrome.runtime.sendMessage({
        protocolVersion: 1,
        type: 'data/clearAll',
        requestId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {},
      });
      if (res?.ok) {
        setStatus('All data cleared');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return <div style={{ padding: '24px' }}>Loading settings...</div>;
  }

  if (!settings) {
    return <div style={{ padding: '24px' }}>Failed to load settings.</div>;
  }

  return (
    <div style={{ maxWidth: '720px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Settings</h2>
      {status && (
        <div
          style={{
            padding: '8px 12px',
            background: '#f0fdf4',
            color: '#166534',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          {status}
        </div>
      )}

      {/* Model Connection */}
      <section style={SECTION_STYLE}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>LiteLLM Connection</h3>
        <div style={{ marginBottom: '12px' }}>
          <label style={LABEL_STYLE}>Base URL</label>
          <input
            type="text"
            style={INPUT_STYLE}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://litellm.example.com"
          />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={LABEL_STYLE}>API Key</label>
          <input
            type="password"
            style={INPUT_STYLE}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.model.hasCredential ? '•••••••• (already set)' : 'Enter API key'}
          />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={LABEL_STYLE}>Model Name</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              style={INPUT_STYLE}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g., gpt-4o-mini, claude-3-5-sonnet, etc."
              list="available-models"
            />
            <button
              style={SECONDARY_BUTTON_STYLE}
              onClick={fetchModels}
              disabled={fetchingModels || !baseUrl}
            >
              {fetchingModels ? 'Fetching...' : 'Fetch Models'}
            </button>
          </div>
          <datalist id="available-models">
            {availableModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            style={BUTTON_STYLE}
            onClick={() => saveSetting({ model: { baseUrl, taskModels: { default: modelName } } })}
            disabled={saving}
          >
            Save Settings
          </button>
          <button
            style={SECONDARY_BUTTON_STYLE}
            onClick={saveCredential}
            disabled={saving || !apiKey.trim()}
          >
            Save API Key
          </button>
          {settings.model.hasCredential && (
            <button style={DANGER_BUTTON_STYLE} onClick={deleteCredential} disabled={saving}>
              Delete Key
            </button>
          )}
          <button
            style={SECONDARY_BUTTON_STYLE}
            onClick={testConnection}
            disabled={testing || !settings.model.hasCredential}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
        {testResult && (
          <div style={{ marginTop: '8px', fontSize: '13px', color: '#374151' }}>{testResult}</div>
        )}
      </section>

      {/* Automation Preferences */}
      <section style={SECTION_STYLE}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Automation Preferences</h3>
        <div style={ROW_STYLE}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Auto-explain on selection</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Skip the trigger button and open the explanation popover automatically
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.selection.autoExplain}
            onChange={(e) => saveSetting({ selection: { autoExplain: e.target.checked } })}
          />
        </div>
        <div style={ROW_STYLE}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Auto-skip exact duplicates</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Skip saving when the same content from the same source already exists
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.automation.skipExactDuplicate}
            onChange={(e) => saveSetting({ automation: { skipExactDuplicate: e.target.checked } })}
          />
        </div>
        <div style={ROW_STYLE}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Auto-append same-card context</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Add new source context to existing cards when content is clearly the same
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.automation.appendExactContext}
            onChange={(e) => saveSetting({ automation: { appendExactContext: e.target.checked } })}
          />
        </div>
        <div style={ROW_STYLE}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>New capture destination</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Where new captures go by default
            </div>
          </div>
          <select
            style={INPUT_STYLE}
            value={settings.automation.newCaptureDestination}
            onChange={(e) =>
              saveSetting({ automation: { newCaptureDestination: e.target.value as 'inbox' | 'library' } })
            }
          >
            <option value="inbox">Inbox (review first)</option>
            <option value="library">Direct to library</option>
          </select>
        </div>
        <div style={ROW_STYLE}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Require confirmation for all writes</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Show a confirmation dialog before any data-modifying operation
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.automation.requireConfirmationForAllWrites}
            onChange={(e) =>
              saveSetting({ automation: { requireConfirmationForAllWrites: e.target.checked } })
            }
          />
        </div>
      </section>

      {/* Review Preferences */}
      <section style={SECTION_STYLE}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Review Preferences</h3>
        <div style={ROW_STYLE}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Daily review limit</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Maximum cards to review per day</div>
          </div>
          <input
            type="number"
            style={{ ...INPUT_STYLE, width: '120px' }}
            value={settings.review.dailyReviewLimit}
            min={1}
            onChange={(e) =>
              saveSetting({ review: { dailyReviewLimit: parseInt(e.target.value, 10) || 200 } })
            }
          />
        </div>
        <div style={ROW_STYLE}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Daily new card limit</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Maximum new cards to introduce per day</div>
          </div>
          <input
            type="number"
            style={{ ...INPUT_STYLE, width: '120px' }}
            value={settings.review.dailyNewLimit}
            min={1}
            onChange={(e) =>
              saveSetting({ review: { dailyNewLimit: parseInt(e.target.value, 10) || 20 } })
            }
          />
        </div>
      </section>

      {/* Data & Site Control */}
      <section style={SECTION_STYLE}>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Data &amp; Site Control</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <button style={BUTTON_STYLE} onClick={handleExportBackup} disabled={saving}>
            Export Backup
          </button>
          <button style={SECONDARY_BUTTON_STYLE} onClick={handleImportBackup} disabled={saving}>
            Import Backup
          </button>
          <button style={SECONDARY_BUTTON_STYLE} onClick={handleExportCsv} disabled={saving}>
            Export CSV
          </button>
          <button style={SECONDARY_BUTTON_STYLE} onClick={handleExportMarkdown} disabled={saving}>
            Export Markdown
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            style={DANGER_BUTTON_STYLE}
            onClick={handleClearInbox}
            disabled={saving}
          >
            Clear Inbox
          </button>
          <button
            style={DANGER_BUTTON_STYLE}
            onClick={handleClearAllData}
            disabled={saving}
          >
            Clear All Data
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
      </section>
    </div>
  );
}

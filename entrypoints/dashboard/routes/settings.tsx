import React, { useEffect, useState } from 'react';
import { useQuery, callMessage } from '@shared/ui/use-message';
import type {
  UserSettingsView,
  ConnectionTestResult,
} from '@shared/protocol/protocol-map';
import type { UserSettings } from '@infra/storage/settings-schema';
import { DEFAULT_PROMPTS } from '@adapters/ai/default-prompts';

// ── Shared inline styles (mirrors App.tsx approach) ──
const section: React.CSSProperties = {
  border: '1px solid #eee',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '20px',
  background: '#fff',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  margin: '0 0 4px',
};
const sectionHint: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
  margin: '0 0 16px',
};
const label: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  marginBottom: '4px',
  color: '#333',
};
const input: React.CSSProperties = {
  width: '100%',
  maxWidth: '420px',
  padding: '8px 10px',
  border: '1px solid #ccc',
  borderRadius: '6px',
  fontSize: '14px',
  boxSizing: 'border-box',
};
const field: React.CSSProperties = { marginBottom: '14px' };
const btn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '6px',
  border: '1px solid #4f46e5',
  background: '#4f46e5',
  color: '#fff',
  fontSize: '14px',
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  ...btn,
  background: '#fff',
  color: '#4f46e5',
};
const btnDanger: React.CSSProperties = {
  ...btn,
  background: '#dc2626',
  borderColor: '#dc2626',
};
const checkboxRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  marginBottom: '10px',
  fontSize: '14px',
};

const TASK_TYPES = ['quick-explain', 'full-analysis', 'practice-generate'] as const;
type TaskType = (typeof TASK_TYPES)[number];

type StatusMsg = { kind: 'ok' | 'err'; text: string } | null;

export default function Settings(): React.JSX.Element {
  const { data, loading, error, reload } = useQuery<UserSettingsView>('settings/get');

  if (loading) return <p style={{ color: '#666' }}>Loading settings…</p>;
  if (error || !data) {
    return (
      <div>
        <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Settings</h2>
        <p style={{ color: '#dc2626' }}>Failed to load settings: {error ?? 'unknown error'}</p>
        <button style={btnSecondary} onClick={reload}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '760px' }}>
      <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Settings</h2>
      <ModelConnection settings={data} reload={reload} />
      <TaskModelsAndPrompts settings={data} reload={reload} />
      <AutomationPrefs settings={data} reload={reload} />
      <ReviewPrefs settings={data} reload={reload} />
      <DataAndSiteControl settings={data} reload={reload} />
    </div>
  );
}

// ── Shared save helper ──
async function patchSettings(patch: Partial<UserSettings>): Promise<void> {
  await callMessage<{ updated: boolean }>('settings/update', { patch });
}

function StatusLine({ msg }: { msg: StatusMsg }): React.JSX.Element | null {
  if (!msg) return null;
  return (
    <p style={{ fontSize: '13px', color: msg.kind === 'ok' ? '#16a34a' : '#dc2626', margin: '8px 0 0' }}>
      {msg.text}
    </p>
  );
}

// ── §14.1 Model connection + test ──
function ModelConnection({
  settings,
  reload,
}: {
  settings: UserSettingsView;
  reload: () => void;
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(settings.model.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<StatusMsg>(null);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setBaseUrl(settings.model.baseUrl), [settings.model.baseUrl]);

  async function saveBaseUrl(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await patchSettings({ model: { baseUrl } as UserSettings['model'] });
      setStatus({ kind: 'ok', text: 'Base URL saved.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function saveKey(): Promise<void> {
    if (!apiKey.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await callMessage<{ credentialRef: string }>('settings/setCredential', { apiKey });
      setApiKey('');
      setStatus({ kind: 'ok', text: 'API key stored securely.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await callMessage<{ removed: boolean }>('settings/clearCredential');
      setStatus({ kind: 'ok', text: 'API key removed.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Clear failed' });
    } finally {
      setBusy(false);
    }
  }

  async function runTest(): Promise<void> {
    setBusy(true);
    setTest(null);
    setStatus(null);
    try {
      // profileId identifies which model profile to test; the default profile
      // is the single configured connection.
      const res = await callMessage<ConnectionTestResult>('aiTask/testConnection', {
        profileId: 'default',
      });
      setTest(res);
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={section}>
      <h3 style={sectionTitle}>Model connection</h3>
      <p style={sectionHint}>
        LiteLLM-compatible endpoint. The API key is write-only: it is stored securely and never
        displayed. (PRD §14.1)
      </p>

      <div style={field}>
        <label style={label} htmlFor="baseUrl">Base URL</label>
        <input
          id="baseUrl"
          style={input}
          type="url"
          placeholder="https://your-litellm-host/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <div style={{ marginTop: '8px' }}>
          <button style={btn} onClick={saveBaseUrl} disabled={busy}>Save base URL</button>
        </div>
      </div>

      <div style={field}>
        <label style={label} htmlFor="apiKey">API key</label>
        <p style={{ fontSize: '13px', color: '#666', margin: '0 0 6px' }}>
          Status:{' '}
          <strong style={{ color: settings.model.hasCredential ? '#16a34a' : '#b45309' }}>
            {settings.model.hasCredential ? 'configured' : 'not configured'}
          </strong>
        </p>
        <input
          id="apiKey"
          style={input}
          type="password"
          placeholder={settings.model.hasCredential ? '•••••••• (enter new key to replace)' : 'sk-…'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
        <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
          <button style={btn} onClick={saveKey} disabled={busy || !apiKey.trim()}>Save key</button>
          <button
            style={btnSecondary}
            onClick={clearKey}
            disabled={busy || !settings.model.hasCredential}
          >
            Clear key
          </button>
        </div>
      </div>

      <div style={field}>
        <button style={btnSecondary} onClick={runTest} disabled={busy}>Test connection</button>
        {test && (
          <p
            style={{
              fontSize: '13px',
              margin: '8px 0 0',
              color: test.ok ? '#16a34a' : '#dc2626',
            }}
          >
            {test.ok ? '✓ Connected' : '✗ Failed'}
            {test.code ? ` [${test.code}]` : ''}: {test.message}
            {typeof test.latencyMs === 'number' ? ` (${test.latencyMs} ms)` : ''}
          </p>
        )}
      </div>
      <StatusLine msg={status} />
    </section>
  );
}

// ── §14.2 Task models + prompts ──
function TaskModelsAndPrompts({
  settings,
  reload,
}: {
  settings: UserSettingsView;
  reload: () => void;
}): React.JSX.Element {
  return (
    <section style={section}>
      <h3 style={sectionTitle}>Task models &amp; prompts</h3>
      <p style={sectionHint}>
        Per-task model id and prompt. Each prompt shows whether the active text is the built-in
        default or your custom override; you can restore the default at any time. (PRD §14.2)
      </p>
      {TASK_TYPES.map((task) => (
        <TaskEditor key={task} task={task} settings={settings} reload={reload} />
      ))}
    </section>
  );
}

function TaskEditor({
  task,
  settings,
  reload,
}: {
  task: TaskType;
  settings: UserSettingsView;
  reload: () => void;
}): React.JSX.Element {
  const override = settings.model.taskPrompts[task];
  const isCustom = Boolean(override);
  const defaultTpl = DEFAULT_PROMPTS[task];

  const [modelId, setModelId] = useState(settings.model.taskModels[task] ?? '');
  const [promptText, setPromptText] = useState(override?.system ?? defaultTpl.system);
  const [status, setStatus] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setModelId(settings.model.taskModels[task] ?? '');
    setPromptText(settings.model.taskPrompts[task]?.system ?? DEFAULT_PROMPTS[task].system);
  }, [settings, task]);

  async function saveModel(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      // Send the full taskModels record (settings merge is shallow per section).
      const taskModels = { ...settings.model.taskModels, [task]: modelId };
      await patchSettings({ model: { taskModels } as UserSettings['model'] });
      setStatus({ kind: 'ok', text: 'Model id saved.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function savePrompt(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      const taskPrompts = {
        ...settings.model.taskPrompts,
        [task]: {
          system: promptText,
          version: override?.version ?? defaultTpl.version,
          updatedAt: new Date().toISOString(),
        },
      };
      await patchSettings({ model: { taskPrompts } as UserSettings['model'] });
      setStatus({ kind: 'ok', text: 'Custom prompt saved.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      // Remove this task's override; resend the remaining record.
      const taskPrompts = { ...settings.model.taskPrompts };
      delete taskPrompts[task];
      await patchSettings({ model: { taskPrompts } as UserSettings['model'] });
      setStatus({ kind: 'ok', text: 'Restored default prompt.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Restore failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: '6px',
        padding: '14px',
        marginBottom: '14px',
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <strong style={{ fontSize: '14px' }}>{task}</strong>
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '10px',
            background: isCustom ? '#fef3c7' : '#e0e7ff',
            color: isCustom ? '#92400e' : '#3730a3',
          }}
        >
          {isCustom ? 'custom' : 'default'}
        </span>
        <span style={{ fontSize: '11px', color: '#999' }}>
          version {override?.version ?? defaultTpl.version}
        </span>
      </div>

      <div style={field}>
        <label style={label} htmlFor={`model-${task}`}>Model id</label>
        <input
          id={`model-${task}`}
          style={input}
          type="text"
          placeholder="e.g. gpt-4o-mini (blank = provider default)"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        />
        <div style={{ marginTop: '8px' }}>
          <button style={btnSecondary} onClick={saveModel} disabled={busy}>Save model id</button>
        </div>
      </div>

      <div style={field}>
        <label style={label} htmlFor={`prompt-${task}`}>System prompt</label>
        <textarea
          id={`prompt-${task}`}
          style={{ ...input, maxWidth: '100%', minHeight: '120px', fontFamily: 'monospace', resize: 'vertical' }}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
        />
        <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
          <button style={btn} onClick={savePrompt} disabled={busy}>Save custom prompt</button>
          <button style={btnSecondary} onClick={restoreDefault} disabled={busy || !isCustom}>
            Restore default
          </button>
        </div>
      </div>
      <StatusLine msg={status} />
    </div>
  );
}

// ── §14.3 Auto-exec / automation prefs ──
function AutomationPrefs({
  settings,
  reload,
}: {
  settings: UserSettingsView;
  reload: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);

  async function apply(patch: Partial<UserSettings>): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await patchSettings(patch);
      setStatus({ kind: 'ok', text: 'Saved.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  const a = settings.automation;

  return (
    <section style={section}>
      <h3 style={sectionTitle}>Automation &amp; capture</h3>
      <p style={sectionHint}>Control what happens automatically on selection and capture. (PRD §14.3)</p>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={settings.selection.autoExplain}
          disabled={busy}
          onChange={(e) =>
            apply({ selection: { autoExplain: e.target.checked } as UserSettings['selection'] })
          }
        />
        <span>
          <strong>Auto-explain on selection</strong>
          <br />
          <span style={{ color: '#666', fontSize: '13px' }}>
            Trigger a quick explanation automatically when text is selected.
          </span>
        </span>
      </label>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={a.skipExactDuplicate}
          disabled={busy}
          onChange={(e) =>
            apply({ automation: { skipExactDuplicate: e.target.checked } as UserSettings['automation'] })
          }
        />
        <span>Skip exact duplicates when capturing</span>
      </label>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={a.appendExactContext}
          disabled={busy}
          onChange={(e) =>
            apply({ automation: { appendExactContext: e.target.checked } as UserSettings['automation'] })
          }
        />
        <span>Append new context to an exact match instead of creating a duplicate</span>
      </label>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={a.autoAddCandidateTags}
          disabled={busy}
          onChange={(e) =>
            apply({ automation: { autoAddCandidateTags: e.target.checked } as UserSettings['automation'] })
          }
        />
        <span>Auto-add candidate tags suggested by the model</span>
      </label>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={a.requireConfirmationForAllWrites}
          disabled={busy}
          onChange={(e) =>
            apply({
              automation: {
                requireConfirmationForAllWrites: e.target.checked,
              } as UserSettings['automation'],
            })
          }
        />
        <span>Require confirmation before every write</span>
      </label>

      <div style={{ ...field, marginTop: '10px' }}>
        <label style={label} htmlFor="newCaptureDestination">Default destination for new captures</label>
        <select
          id="newCaptureDestination"
          style={{ ...input, maxWidth: '260px' }}
          value={a.newCaptureDestination}
          disabled={busy}
          onChange={(e) =>
            apply({
              automation: {
                newCaptureDestination: e.target.value as 'inbox' | 'library',
              } as UserSettings['automation'],
            })
          }
        >
          <option value="inbox">Inbox (review before saving)</option>
          <option value="library">Library (save directly)</option>
        </select>
      </div>
      <StatusLine msg={status} />
    </section>
  );
}

// ── §14.4 Review prefs ──
function ReviewPrefs({
  settings,
  reload,
}: {
  settings: UserSettingsView;
  reload: () => void;
}): React.JSX.Element {
  const r = settings.review;
  const [status, setStatus] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);

  // Local draft for numeric/text fields (committed on blur / save).
  const [dailyReviewLimit, setDailyReviewLimit] = useState(String(r.dailyReviewLimit));
  const [dailyNewLimit, setDailyNewLimit] = useState(String(r.dailyNewLimit));
  const [reqRetention, setReqRetention] = useState(
    r.fsrsRequestRetention != null ? String(r.fsrsRequestRetention) : '',
  );
  const [maxInterval, setMaxInterval] = useState(
    r.fsrsMaximumInterval != null ? String(r.fsrsMaximumInterval) : '',
  );

  useEffect(() => {
    setDailyReviewLimit(String(r.dailyReviewLimit));
    setDailyNewLimit(String(r.dailyNewLimit));
    setReqRetention(r.fsrsRequestRetention != null ? String(r.fsrsRequestRetention) : '');
    setMaxInterval(r.fsrsMaximumInterval != null ? String(r.fsrsMaximumInterval) : '');
  }, [r]);

  async function apply(patch: Partial<UserSettings['review']>): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await patchSettings({ review: patch as UserSettings['review'] });
      setStatus({ kind: 'ok', text: 'Saved.' });
      reload();
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  }

  async function saveLimits(): Promise<void> {
    const rev = parseInt(dailyReviewLimit, 10);
    const nw = parseInt(dailyNewLimit, 10);
    if (!Number.isFinite(rev) || rev <= 0 || !Number.isFinite(nw) || nw <= 0) {
      setStatus({ kind: 'err', text: 'Daily limits must be positive integers.' });
      return;
    }
    await apply({ dailyReviewLimit: rev, dailyNewLimit: nw });
  }

  async function saveFsrs(): Promise<void> {
    const patch: Partial<UserSettings['review']> = {};
    if (reqRetention.trim()) {
      const v = parseFloat(reqRetention);
      if (!Number.isFinite(v) || v < 0.7 || v > 0.99) {
        setStatus({ kind: 'err', text: 'Request retention must be between 0.70 and 0.99.' });
        return;
      }
      patch.fsrsRequestRetention = v;
    }
    if (maxInterval.trim()) {
      const v = parseInt(maxInterval, 10);
      if (!Number.isFinite(v) || v <= 0) {
        setStatus({ kind: 'err', text: 'Maximum interval must be a positive integer.' });
        return;
      }
      patch.fsrsMaximumInterval = v;
    }
    await apply(patch);
  }

  return (
    <section style={section}>
      <h3 style={sectionTitle}>Review &amp; scheduling</h3>
      <p style={sectionHint}>Daily limits, ordering, and optional FSRS overrides. (PRD §14.4)</p>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div style={field}>
          <label style={label} htmlFor="dailyReviewLimit">Daily review limit</label>
          <input
            id="dailyReviewLimit"
            style={{ ...input, maxWidth: '160px' }}
            type="number"
            min={1}
            value={dailyReviewLimit}
            onChange={(e) => setDailyReviewLimit(e.target.value)}
          />
        </div>
        <div style={field}>
          <label style={label} htmlFor="dailyNewLimit">Daily new-card limit</label>
          <input
            id="dailyNewLimit"
            style={{ ...input, maxWidth: '160px' }}
            type="number"
            min={1}
            value={dailyNewLimit}
            onChange={(e) => setDailyNewLimit(e.target.value)}
          />
        </div>
      </div>
      <div style={{ marginBottom: '14px' }}>
        <button style={btn} onClick={saveLimits} disabled={busy}>Save limits</button>
      </div>

      <div style={field}>
        <label style={label} htmlFor="defaultReviewMode">Default review mode</label>
        <select
          id="defaultReviewMode"
          style={{ ...input, maxWidth: '260px' }}
          value={r.defaultReviewMode}
          disabled={busy}
          onChange={(e) => apply({ defaultReviewMode: e.target.value as UserSettings['review']['defaultReviewMode'] })}
        >
          <option value="quick">Quick</option>
          <option value="input">Input</option>
          <option value="cloze">Cloze</option>
          <option value="imitation">Imitation</option>
          <option value="distinction">Distinction</option>
        </select>
      </div>

      <div style={field}>
        <label style={label} htmlFor="newCardStartPolicy">New-card start policy</label>
        <select
          id="newCardStartPolicy"
          style={{ ...input, maxWidth: '260px' }}
          value={r.newCardStartPolicy}
          disabled={busy}
          onChange={(e) => apply({ newCardStartPolicy: e.target.value as UserSettings['review']['newCardStartPolicy'] })}
        >
          <option value="immediately">Immediately</option>
          <option value="next-day">Next day</option>
        </select>
      </div>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={r.prioritizeHard}
          disabled={busy}
          onChange={(e) => apply({ prioritizeHard: e.target.checked })}
        />
        <span>Prioritize hard/lapsed cards first</span>
      </label>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={r.enableTargetedPractice}
          disabled={busy}
          onChange={(e) => apply({ enableTargetedPractice: e.target.checked })}
        />
        <span>Enable targeted practice generation</span>
      </label>

      <label style={checkboxRow}>
        <input
          type="checkbox"
          checked={r.allowPracticeAffectsFsrs}
          disabled={busy}
          onChange={(e) => apply({ allowPracticeAffectsFsrs: e.target.checked })}
        />
        <span>
          Allow practice results to affect FSRS scheduling
          <br />
          <span style={{ color: '#666', fontSize: '13px' }}>Off by default; practice never changes scheduling unless enabled.</span>
        </span>
      </label>

      <h4 style={{ fontSize: '14px', margin: '16px 0 6px' }}>Optional FSRS overrides</h4>
      <p style={{ ...sectionHint, marginBottom: '10px' }}>Leave blank to use safe ts-fsrs defaults.</p>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div style={field}>
          <label style={label} htmlFor="reqRetention">Request retention (0.70–0.99)</label>
          <input
            id="reqRetention"
            style={{ ...input, maxWidth: '160px' }}
            type="number"
            step="0.01"
            min={0.7}
            max={0.99}
            value={reqRetention}
            onChange={(e) => setReqRetention(e.target.value)}
          />
        </div>
        <div style={field}>
          <label style={label} htmlFor="maxInterval">Maximum interval (days)</label>
          <input
            id="maxInterval"
            style={{ ...input, maxWidth: '160px' }}
            type="number"
            min={1}
            value={maxInterval}
            onChange={(e) => setMaxInterval(e.target.value)}
          />
        </div>
      </div>
      <div>
        <button style={btn} onClick={saveFsrs} disabled={busy}>Save FSRS overrides</button>
      </div>
      <StatusLine msg={status} />
    </section>
  );
}

// ── §14.5 Data & site control ──
function triggerDownload(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ImportPreview = {
  databaseName: string;
  tables: Array<{ name: string; rowCount: number }>;
  confirmationToken: string;
};

function DataAndSiteControl({
  settings,
  reload,
}: {
  settings: UserSettingsView;
  reload: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);

  // Import flow state
  const [importData, setImportData] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');

  // Disabled sites editor
  const [newSite, setNewSite] = useState('');

  function note(kind: 'ok' | 'err', text: string): void {
    setStatus({ kind, text });
  }

  async function exportBackup(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      const res = await callMessage<{ manifest: unknown; data: string }>('data/exportBackup');
      triggerDownload(`lexiflow-backup-${new Date().toISOString().slice(0, 10)}.json`, res.data, 'application/json');
      note('ok', 'Backup downloaded.');
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      const res = await callMessage<{ csv: string }>('data/exportCsv');
      triggerDownload(`lexiflow-cards-${new Date().toISOString().slice(0, 10)}.csv`, res.csv, 'text/csv');
      note('ok', 'CSV downloaded.');
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function exportMarkdown(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      const res = await callMessage<{ markdown: string }>('data/exportMarkdown');
      triggerDownload(`lexiflow-cards-${new Date().toISOString().slice(0, 10)}.md`, res.markdown, 'text/markdown');
      note('ok', 'Markdown downloaded.');
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setStatus(null);
    setPreview(null);
    try {
      const text = await file.text();
      const res = await callMessage<ImportPreview>('data/previewImport', { data: text });
      setImportData(text);
      setPreview(res);
      note('ok', `Previewed "${res.databaseName}". Review tables and confirm.`);
    } catch (err) {
      note('err', err instanceof Error ? err.message : 'Could not read file');
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    if (!preview || importData == null) return;
    setBusy(true);
    setStatus(null);
    try {
      await callMessage<{ imported: boolean }>('data/import', {
        data: importData,
        mode: importMode,
        tableCount: preview.tables.length,
        confirmationToken: preview.confirmationToken,
      });
      note('ok', `Import complete (${importMode}).`);
      setPreview(null);
      setImportData(null);
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function clearInbox(): Promise<void> {
    if (
      !window.confirm(
        'Clear all Inbox items? Consider exporting a backup first. This cannot be undone. Continue?',
      )
    )
      return;
    if (!window.confirm('Are you absolutely sure? Inbox items will be permanently removed.')) return;
    setBusy(true);
    setStatus(null);
    try {
      const { token } = await callMessage<{ token: string }>('data/mintConfirmation', {
        operation: 'data.clear-inbox',
      });
      const res = await callMessage<{ cleared: number }>('data/clearInbox', { confirmationToken: token });
      note('ok', `Cleared ${res.cleared} inbox item(s).`);
      reload();
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  async function clearAll(): Promise<void> {
    if (
      !window.confirm(
        'Delete ALL data (cards, history, inbox)? Export a backup first. This cannot be undone. Continue?',
      )
    )
      return;
    if (!window.confirm('FINAL CONFIRMATION: permanently erase everything?')) return;
    setBusy(true);
    setStatus(null);
    try {
      const { token } = await callMessage<{ token: string }>('data/mintConfirmation', {
        operation: 'data.clear-all',
      });
      await callMessage<{ cleared: true }>('data/clearAll', { confirmationToken: token });
      note('ok', 'All data cleared.');
      reload();
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  async function rebuildSearch(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await callMessage<{ ok: true }>('knowledge/rebuildSearch', { reason: 'manual-settings-rebuild' });
      note('ok', 'Search index rebuilt.');
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Rebuild failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveSites(sites: string[]): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      await patchSettings({ selection: { disabledSites: sites } as UserSettings['selection'] });
      note('ok', 'Disabled sites updated.');
      reload();
    } catch (e) {
      note('err', e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function addSite(): void {
    const s = newSite.trim();
    if (!s) return;
    if (settings.selection.disabledSites.includes(s)) {
      note('err', 'Site already disabled.');
      return;
    }
    setNewSite('');
    void saveSites([...settings.selection.disabledSites, s]);
  }

  function removeSite(site: string): void {
    void saveSites(settings.selection.disabledSites.filter((s) => s !== site));
  }

  return (
    <section style={section}>
      <h3 style={sectionTitle}>Data &amp; site control</h3>
      <p style={sectionHint}>Export, import, disabled sites, and destructive maintenance. (PRD §14.5)</p>

      <h4 style={{ fontSize: '14px', margin: '0 0 8px' }}>Export</h4>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <button style={btn} onClick={exportBackup} disabled={busy}>Export full backup (.json)</button>
        <button style={btnSecondary} onClick={exportCsv} disabled={busy}>Export CSV</button>
        <button style={btnSecondary} onClick={exportMarkdown} disabled={busy}>Export Markdown</button>
      </div>

      <h4 style={{ fontSize: '14px', margin: '0 0 8px' }}>Import</h4>
      <div style={{ marginBottom: '10px' }}>
        <label style={label} htmlFor="importFile">Backup file (.json)</label>
        <input id="importFile" type="file" accept="application/json,.json" onChange={onFilePicked} disabled={busy} />
      </div>
      {preview && (
        <div
          style={{
            border: '1px solid #e0e7ff',
            background: '#f5f7ff',
            borderRadius: '6px',
            padding: '12px',
            marginBottom: '18px',
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: '14px' }}>
            Database: <strong>{preview.databaseName}</strong>
          </p>
          <table style={{ borderCollapse: 'collapse', fontSize: '13px', marginBottom: '10px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '2px 16px 2px 0' }}>Table</th>
                <th style={{ textAlign: 'right', padding: '2px 0' }}>Rows</th>
              </tr>
            </thead>
            <tbody>
              {preview.tables.map((t) => (
                <tr key={t.name}>
                  <td style={{ padding: '2px 16px 2px 0' }}>{t.name}</td>
                  <td style={{ textAlign: 'right', padding: '2px 0' }}>{t.rowCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: '13px' }}>
              Mode:{' '}
              <select
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'replace' | 'merge')}
                style={{ padding: '4px 6px' }}
              >
                <option value="merge">Merge</option>
                <option value="replace">Replace (overwrites existing)</option>
              </select>
            </label>
            <button style={btn} onClick={confirmImport} disabled={busy}>Confirm import</button>
            <button
              style={btnSecondary}
              onClick={() => {
                setPreview(null);
                setImportData(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <h4 style={{ fontSize: '14px', margin: '0 0 8px' }}>Disabled sites</h4>
      <p style={{ ...sectionHint, marginBottom: '10px' }}>
        Selection features are off on origins matching these entries.
      </p>
      {settings.selection.disabledSites.length === 0 ? (
        <p style={{ color: '#666', fontSize: '13px', margin: '0 0 10px' }}>No disabled sites.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px' }}>
          {settings.selection.disabledSites.map((site) => (
            <li
              key={site}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '14px' }}
            >
              <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>{site}</code>
              <button
                style={{ ...btnSecondary, padding: '2px 8px', fontSize: '12px', color: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => removeSite(site)}
                disabled={busy}
                aria-label={`Remove ${site}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
        <input
          style={{ ...input, maxWidth: '320px' }}
          type="text"
          placeholder="example.com"
          value={newSite}
          onChange={(e) => setNewSite(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addSite();
          }}
          aria-label="New disabled site"
        />
        <button style={btn} onClick={addSite} disabled={busy}>Add site</button>
      </div>

      <h4 style={{ fontSize: '14px', margin: '0 0 8px' }}>Maintenance</h4>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button style={btnSecondary} onClick={rebuildSearch} disabled={busy}>Rebuild search index</button>
        <button style={btnDanger} onClick={clearInbox} disabled={busy}>Clear inbox…</button>
        <button style={btnDanger} onClick={clearAll} disabled={busy}>Clear all data…</button>
      </div>
      <StatusLine msg={status} />
    </section>
  );
}

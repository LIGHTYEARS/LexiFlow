import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSettings,
  saveSettings,
  updateSettings,
  getSitePolicyView,
  saveCredential,
  getCredentialValue,
  hasCredential,
  deleteCredential,
} from '@infra/storage/settings-gateway';
import { DEFAULT_SETTINGS } from '@infra/storage/settings-schema';

describe('SettingsGateway', () => {
  beforeEach(() => {
    // Clear mock storage between tests
    // Test mock: as unknown as ... is the standard pattern for mocking Chrome API functions in tests
    (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({});
    (chrome.storage.local.set as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(undefined);
    (chrome.storage.local.remove as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(undefined);
  });

  describe('getSettings', () => {
    it('returns defaults when nothing stored', async () => {
      const settings = await getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('returns stored settings when valid', async () => {
      const custom = {
        ...DEFAULT_SETTINGS,
        selection: { autoExplain: true, disabledSites: ['example.com'] },
      };
      (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        'lexiflow:settings': custom,
      });

      const settings = await getSettings();
      expect(settings.selection.autoExplain).toBe(true);
      expect(settings.selection.disabledSites).toEqual(['example.com']);
    });

    it('falls back to defaults when stored data is invalid', async () => {
      (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        'lexiflow:settings': { invalid: true },
      });

      const settings = await getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe('saveSettings', () => {
    it('saves valid settings', async () => {
      const result = await saveSettings(DEFAULT_SETTINGS);
      expect(result.success).toBe(true);
    });

    it('rejects invalid settings', async () => {
      // Intentionally invalid: as unknown as typeof DEFAULT_SETTINGS forces invalid input to test the validation fallback path
      const result = await saveSettings({ ...DEFAULT_SETTINGS, schemaVersion: 999 } as unknown as typeof DEFAULT_SETTINGS);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');
    });
  });

  describe('updateSettings', () => {
    it('merges patch with existing settings', async () => {
      const result = await updateSettings({
        selection: { autoExplain: true, disabledSites: [] },
      });
      expect(result.success).toBe(true);
      expect(result.settings?.selection.autoExplain).toBe(true);
      // Other settings should remain default
      expect(result.settings?.review.dailyNewLimit).toBe(DEFAULT_SETTINGS.review.dailyNewLimit);
    });
  });

  describe('getSitePolicyView', () => {
    it('returns enabled when site not in disabled list', async () => {
      const view = await getSitePolicyView('https://example.com');
      expect(view.enabled).toBe(true);
      expect(view.autoExplain).toBe(false);
    });

    it('returns disabled when site is in disabled list', async () => {
      (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        'lexiflow:settings': {
          ...DEFAULT_SETTINGS,
          selection: { autoExplain: false, disabledSites: ['example.com'] },
        },
      });

      const view = await getSitePolicyView('https://example.com/page');
      expect(view.enabled).toBe(false);
    });

    it('reflects autoExplain setting', async () => {
      (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        'lexiflow:settings': {
          ...DEFAULT_SETTINGS,
          selection: { autoExplain: true, disabledSites: [] },
        },
      });

      const view = await getSitePolicyView('https://example.com');
      expect(view.autoExplain).toBe(true);
    });
  });

  describe('Credentials', () => {
    it('saves and retrieves a credential', async () => {
      const saveResult = await saveCredential('litellm-api-key', 'sk-test123');
      expect(saveResult.success).toBe(true);
      expect(saveResult.credentialRef).toBeDefined();

      // Mock the stored credential
      (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        'lexiflow:credentials': {
          id: saveResult.credentialRef,
          type: 'litellm-api-key',
          encryptedValue: 'sk-test123',
          createdAt: new Date().toISOString(),
        },
      });

      // Non-null assertion: test setup above guarantees credentialRef is set
      const value = await getCredentialValue(saveResult.credentialRef!);
      expect(value).toBe('sk-test123');
    });

    it('reports credential presence', async () => {
      (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        'lexiflow:credentials': {
          id: 'test-id',
          type: 'litellm-api-key',
          encryptedValue: 'sk-test',
          createdAt: new Date().toISOString(),
        },
      });

      expect(await hasCredential()).toBe(true);
    });

    it('deletes a credential', async () => {
      await deleteCredential();
      expect(chrome.storage.local.remove).toHaveBeenCalledWith('lexiflow:credentials');
    });

    it('returns null when credential not found', async () => {
      (chrome.storage.local.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({});
      const value = await getCredentialValue('nonexistent');
      expect(value).toBeNull();
    });
  });
});

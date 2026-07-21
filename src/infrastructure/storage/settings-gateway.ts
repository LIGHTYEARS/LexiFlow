import { createError } from '@shared/protocol/envelope';
import type { AppError } from '@shared/protocol/envelope';
import { UserSettingsSchema, DEFAULT_SETTINGS, CredentialSchema } from './settings-schema';
import type { UserSettings, Credential } from './settings-schema';

/**
 * SettingsGateway — the only access point for settings and credentials.
 * Content scripts must NOT use this directly — they use SitePolicyView queries.
 * See technical-design/04 §3.2, §9 and technical-design/02 §4.2.
 */

const SETTINGS_KEY = 'lexiflow:settings';
const CREDENTIALS_KEY = 'lexiflow:credentials';
const SCHEMA_VERSION_KEY = 'lexiflow:schemaVersion';

/**
 * Initialize storage access level to trusted contexts only.
 * Must be called once at startup (background service worker).
 */
export async function initializeStorageAccess(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (error) {
    console.error('[LexiFlow] Failed to set storage access level:', error);
  }
}

/**
 * Get all user settings. Falls back to defaults if not set or invalid.
 * Only callable from trusted extension contexts (background, dashboard, popup, sidepanel).
 */
export async function getSettings(): Promise<UserSettings> {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    const raw: unknown = result[SETTINGS_KEY];

    if (!raw) {
      // First run — save and return defaults
      await saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }

    // Validate stored settings against schema
    const parsed = UserSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[LexiFlow] Invalid settings stored, using defaults:', parsed.error);
      return { ...DEFAULT_SETTINGS };
    }

    return parsed.data;
  } catch (error) {
    console.error('[LexiFlow] Failed to read settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save user settings. Validates against schema before writing.
 */
export async function saveSettings(settings: UserSettings): Promise<{
  success: boolean;
  error?: AppError;
}> {
  const parsed = UserSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    return {
      success: false,
      error: createError('INVALID_INPUT', 'Invalid settings: ' + parsed.error.message, false),
    };
  }

  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: parsed.data });
    return { success: true };
  } catch {
    return {
      success: false,
      error: createError('STORAGE_FAILURE', 'Failed to save settings', true),
    };
  }
}

/**
 * Update a partial settings patch. Merges with existing settings.
 */
export async function updateSettings(
  patch: Partial<UserSettings>,
): Promise<{ success: boolean; settings?: UserSettings; error?: AppError }> {
  const current = await getSettings();

  // Deep merge for nested objects — skip undefined values to avoid wiping existing data
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([_, v]) => v !== undefined)
  ) as Partial<UserSettings>;
  const merged: UserSettings = {
    ...current,
    ...cleanPatch,
    selection: { ...current.selection, ...cleanPatch.selection },
    automation: { ...current.automation, ...cleanPatch.automation },
    review: { ...current.review, ...cleanPatch.review },
    model: {
      ...current.model,
      ...Object.fromEntries(
        Object.entries(cleanPatch.model || {}).filter(([_, v]) => v !== undefined)
      ),
    },
  };

  return { ...(await saveSettings(merged)), settings: merged };
}

/**
 * Get a derived view of site policy for content scripts.
 * This is the ONLY settings data content scripts can receive.
 */
export async function getSitePolicyView(origin: string): Promise<{
  origin: string;
  enabled: boolean;
  autoExplain: boolean;
}> {
  const settings = await getSettings();
  const disabled = settings.selection.disabledSites.some((site) => origin.includes(site));

  return {
    origin,
    enabled: !disabled,
    autoExplain: settings.selection.autoExplain,
  };
}

/**
 * Store a credential (e.g., LiteLLM API key).
 * Credentials are stored separately from settings and never exported.
 */
export async function saveCredential(
  type: 'litellm-api-key',
  value: string,
): Promise<{ success: boolean; credentialRef?: string; error?: AppError }> {
  const credentialId = crypto.randomUUID();
  const credential: Credential = {
    id: credentialId,
    type,
    encryptedValue: value, // In production, use Web Crypto for encryption. M0 uses plain storage.
    createdAt: new Date().toISOString(),
  };

  try {
    await chrome.storage.local.set({ [CREDENTIALS_KEY]: credential });
    return { success: true, credentialRef: credentialId };
  } catch {
    return {
      success: false,
      error: createError('STORAGE_FAILURE', 'Failed to save credential', true),
    };
  }
}

/**
 * Retrieve a credential by its reference.
 * Returns the raw value for use in SDK adapters only.
 */
export async function getCredentialValue(credentialRef: string): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(CREDENTIALS_KEY);
    const raw: unknown = result[CREDENTIALS_KEY];
    const parsed = CredentialSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    const credential = parsed.data;
    if (credential.id === credentialRef) {
      return credential.encryptedValue;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a credential is set (without returning the value).
 */
export async function hasCredential(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(CREDENTIALS_KEY);
    const raw: unknown = result[CREDENTIALS_KEY];
    return !!raw;
  } catch {
    return false;
  }
}

/**
 * Delete a credential.
 */
export async function deleteCredential(): Promise<void> {
  try {
    await chrome.storage.local.remove(CREDENTIALS_KEY);
  } catch (error) {
    console.error('[LexiFlow] Failed to delete credential:', error);
  }
}

/**
 * Get the database schema version marker.
 */
export async function getSchemaVersion(): Promise<number> {
  try {
    const result = await chrome.storage.local.get(SCHEMA_VERSION_KEY);
    const raw: unknown = result[SCHEMA_VERSION_KEY];
    return typeof raw === 'number' ? raw : 0;
  } catch {
    return 0;
  }
}

/**
 * Set the database schema version marker.
 */
export async function setSchemaVersion(version: number): Promise<void> {
  try {
    await chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: version });
  } catch (error) {
    console.error('[LexiFlow] Failed to set schema version:', error);
  }
}

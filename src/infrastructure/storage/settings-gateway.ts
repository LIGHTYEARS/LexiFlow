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
 * Accepts a deep partial — nested objects are merged recursively.
 */
export async function updateSettings(
  patch: Record<string, unknown>,
): Promise<{ success: boolean; settings?: UserSettings; error?: AppError }> {
  const current = await getSettings();

  // Deep merge for nested objects
  const merged: UserSettings = {
    ...current,
    ...patch,
    selection: { ...current.selection, ...(patch.selection as Record<string, unknown> || {}) },
    automation: { ...current.automation, ...(patch.automation as Record<string, unknown> || {}) },
    review: { ...current.review, ...(patch.review as Record<string, unknown> || {}) },
    model: { ...current.model, ...(patch.model as Record<string, unknown> || {}) },
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
 * Uses Web Crypto AES-GCM encryption at rest.
 */

// Encryption key stored separately from the credential itself.
const ENCRYPTION_KEY_KEY = 'lexiflow:encryption-key';

async function getEncryptionKey(): Promise<CryptoKey> {
  const result = await chrome.storage.local.get(ENCRYPTION_KEY_KEY);
  const raw = result[ENCRYPTION_KEY_KEY] as string | undefined;
  if (raw) {
    const keyData = new Uint8Array(atob(raw).split('').map((c) => c.charCodeAt(0)));
    return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  // Generate a new key on first use
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  const exportedStr = btoa(String.fromCharCode(...new Uint8Array(exported)));
  await chrome.storage.local.set({ [ENCRYPTION_KEY_KEY]: exportedStr });
  return key;
}

async function encryptValue(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptValue(encrypted: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = new Uint8Array(atob(encrypted).split('').map((c) => c.charCodeAt(0)));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

export async function saveCredential(
  type: 'litellm-api-key',
  value: string,
): Promise<{ success: boolean; credentialRef?: string; error?: AppError }> {
  const credentialId = crypto.randomUUID();

  try {
    const encryptedValue = await encryptValue(value);
    const credential: Credential = {
      id: credentialId,
      type,
      encryptedValue,
      createdAt: new Date().toISOString(),
    };
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
      // Try to decrypt; if it fails (e.g., legacy plaintext storage), return as-is
      try {
        return await decryptValue(credential.encryptedValue);
      } catch {
        return credential.encryptedValue;
      }
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

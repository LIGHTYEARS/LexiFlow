import { z } from 'zod';

/**
 * User settings schema — stored in WXT typed storage (chrome.storage.local).
 * Only small settings, site rules, and schema version go here.
 * Domain entities and history do NOT. See technical-design/04 §9.
 */
export const UserSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  selection: z.object({
    autoExplain: z.boolean().default(false),
    disabledSites: z.array(z.string()).default([]),
  }),
  automation: z.object({
    skipExactDuplicate: z.boolean().default(true),
    appendExactContext: z.boolean().default(true),
    newCaptureDestination: z.enum(['inbox', 'library']).default('inbox'),
    requireConfirmationForAllWrites: z.boolean().default(false),
  }),
  review: z.object({
    dailyReviewLimit: z.number().int().positive().default(200),
    dailyNewLimit: z.number().int().positive().default(20),
    reminderTime: z.string().optional(),
  }),
  model: z.object({
    baseUrl: z.string().default(''),
    credentialRef: z.string().optional(),
    taskModels: z.record(z.string()).default({}),
  }),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;

/**
 * Default settings — used on first install and for missing fields.
 */
export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: 1,
  selection: {
    autoExplain: false,
    disabledSites: [],
  },
  automation: {
    skipExactDuplicate: true,
    appendExactContext: true,
    newCaptureDestination: 'inbox',
    requireConfirmationForAllWrites: false,
  },
  review: {
    dailyReviewLimit: 200,
    dailyNewLimit: 20,
  },
  model: {
    baseUrl: '',
    taskModels: {},
  },
};

/**
 * Credentials are stored separately from settings and are never exposed
 * to content scripts or exported in backups.
 */
export const CredentialSchema = z.object({
  id: z.string(),
  type: z.enum(['litellm-api-key']),
  encryptedValue: z.string(),
  createdAt: z.string().datetime(),
});

export type Credential = z.infer<typeof CredentialSchema>;

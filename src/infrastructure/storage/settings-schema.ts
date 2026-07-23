import { z } from 'zod';

/**
 * User settings schema — stored in WXT typed storage (chrome.storage.local).
 * Only small settings, site rules, and schema version go here.
 * Domain entities and history do NOT. See technical-design/04 §9.
 */
/**
 * A per-task custom prompt override (PRD §14.2). When present, it takes
 * precedence over the built-in default. `version` records which default the
 * user customized from so default upgrades never silently overwrite it.
 */
export const TaskPromptOverrideSchema = z.object({
  system: z.string(),
  version: z.string(),
  updatedAt: z.string(),
});

export type TaskPromptOverride = z.infer<typeof TaskPromptOverrideSchema>;

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
    autoAddCandidateTags: z.boolean().default(false),
    requireConfirmationForAllWrites: z.boolean().default(false),
  }),
  review: z.object({
    dailyReviewLimit: z.number().int().positive().default(200),
    dailyNewLimit: z.number().int().positive().default(20),
    reminderTime: z.string().optional(),
    prioritizeHard: z.boolean().default(false),
    defaultReviewMode: z
      .enum(['quick', 'input', 'cloze', 'imitation', 'distinction'])
      .default('quick'),
    newCardStartPolicy: z.enum(['immediately', 'next-day']).default('immediately'),
    enableTargetedPractice: z.boolean().default(true),
    /** Practice results never affect FSRS unless the user opts in (§12.5, §19.6). */
    allowPracticeAffectsFsrs: z.boolean().default(false),
    /** Optional FSRS overrides; safe defaults come from ts-fsrs when unset (§14.4). */
    fsrsRequestRetention: z.number().min(0.7).max(0.99).optional(),
    fsrsMaximumInterval: z.number().int().positive().optional(),
  }),
  model: z.object({
    baseUrl: z.string().default(''),
    credentialRef: z.string().optional(),
    taskModels: z.record(z.string()).default({}),
    /** Per-task custom prompt overrides, keyed by task type (§14.2). */
    taskPrompts: z.record(TaskPromptOverrideSchema).default({}),
    requestTimeoutMs: z.number().int().positive().default(30000),
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
    autoAddCandidateTags: false,
    requireConfirmationForAllWrites: false,
  },
  review: {
    dailyReviewLimit: 200,
    dailyNewLimit: 20,
    reminderTime: undefined,
    prioritizeHard: false,
    defaultReviewMode: 'quick',
    newCardStartPolicy: 'immediately',
    enableTargetedPractice: true,
    allowPracticeAffectsFsrs: false,
  },
  model: {
    baseUrl: '',
    taskModels: {},
    taskPrompts: {},
    requestTimeoutMs: 30000,
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

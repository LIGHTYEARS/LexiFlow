import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock Chrome extension APIs for unit/integration tests
const chromeMock = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: (path: string) => `chrome-extension://test/${path}`,
    id: 'test-extension-id',
    getManifest: vi.fn().mockReturnValue({ version: '0.1.0' }),
    onInstalled: {
      addListener: vi.fn(),
    },
  },
  permissions: {
    request: vi.fn().mockResolvedValue({ granted: true }),
    contains: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue({ removed: true }),
    getAll: vi.fn().mockResolvedValue({ origins: [], permissions: [] }),
    onAdded: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  scripting: {
    registerContentScripts: vi.fn().mockResolvedValue(undefined),
    unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
    executeScript: vi.fn().mockResolvedValue(undefined),
    getRegisteredContentScripts: vi.fn().mockResolvedValue([]),
  },
  sidePanel: {
    open: vi.fn().mockResolvedValue(undefined),
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
  },
  commands: {
    onCommand: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: 2 }),
    onActivated: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  },
} as unknown as typeof chrome;

globalThis.chrome = chromeMock;

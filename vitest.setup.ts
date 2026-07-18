import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock Chrome extension APIs
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      setAccessLevel: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    getURL: (path: string) => `chrome-extension://test/${path}`,
    id: 'test-extension-id',
  },
  permissions: {
    request: vi.fn(),
    contains: vi.fn(),
    remove: vi.fn(),
    getAll: vi.fn(),
    onAdded: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  scripting: {
    registerContentScripts: vi.fn(),
    unregisterContentScripts: vi.fn(),
    executeScript: vi.fn(),
    getRegisteredContentScripts: vi.fn(),
  },
  sidePanel: {
    open: vi.fn(),
    setPanelBehavior: vi.fn(),
  },
  commands: {
    onCommand: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    onActivated: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  },
} as unknown as typeof chrome;

globalThis.chrome = chromeMock;

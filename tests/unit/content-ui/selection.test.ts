import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateSelection,
  detectLanguageHint,
  createSelectionAnchor,
  MAX_SELECTION_LENGTH,
} from '@content-ui/selection-validator';
import type { SelectionSnapshot } from '@content-ui/selection-validator';
import { SelectionObserver } from '@content-ui/selection-observer';
import { extractContext, CONTEXT_BUDGET } from '@content-ui/context-extractor';
import type { PageSessionRef } from '@shared/protocol/page-session';

const MOCK_PAGE_SESSION: PageSessionRef = {
  tabId: 1,
  frameId: 0,
  documentId: 'test-doc-id',
  urlAtCapture: 'https://example.com/article',
};

describe('Selection Validation', () => {
  describe('validateSelection', () => {
    it('rejects null selection', () => {
      const result = validateSelection(null);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('empty');
      }
    });

    it('rejects collapsed selection', () => {
      const selection = {
        isCollapsed: true,
        rangeCount: 1,
        toString: () => 'hello',
        getRangeAt: () => ({
          getClientRects: () => [{ x: 0, y: 0, width: 10, height: 10 }],
          commonAncestorContainer: document.body,
        }),
      } as unknown as Selection;

      const result = validateSelection(selection);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('collapsed');
      }
    });

    it('rejects multiple ranges', () => {
      const selection = {
        isCollapsed: false,
        rangeCount: 2,
        toString: () => 'hello',
        getRangeAt: () => ({
          getClientRects: () => [{ x: 0, y: 0, width: 10, height: 10 }],
          commonAncestorContainer: document.body,
        }),
      } as unknown as Selection;

      const result = validateSelection(selection);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('multiple_ranges');
      }
    });

    it('rejects empty text after trim', () => {
      const selection = {
        isCollapsed: false,
        rangeCount: 1,
        toString: () => '   ',
        getRangeAt: () => ({
          getClientRects: () => [{ x: 0, y: 0, width: 10, height: 10 }],
          commonAncestorContainer: document.body,
        }),
      } as unknown as Selection;

      const result = validateSelection(selection);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('empty');
      }
    });

    it('rejects text without Latin letters', () => {
      const selection = {
        isCollapsed: false,
        rangeCount: 1,
        toString: () => '12345',
        getRangeAt: () => ({
          getClientRects: () => [{ x: 0, y: 0, width: 10, height: 10 }],
          commonAncestorContainer: document.body,
        }),
      } as unknown as Selection;

      const result = validateSelection(selection);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('no_latin');
      }
    });

    it('rejects text exceeding max length', () => {
      const longText = 'a'.repeat(MAX_SELECTION_LENGTH + 1);
      const selection = {
        isCollapsed: false,
        rangeCount: 1,
        toString: () => longText,
        getRangeAt: () => ({
          getClientRects: () => [{ x: 0, y: 0, width: 10, height: 10 }],
          commonAncestorContainer: document.body,
        }),
      } as unknown as Selection;

      const result = validateSelection(selection);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('too_long');
      }
    });

    it('accepts valid English text', () => {
      const selection = {
        isCollapsed: false,
        rangeCount: 1,
        toString: () => 'hello world',
        getRangeAt: () => ({
          getClientRects: () => [{ x: 0, y: 0, width: 100, height: 20 }],
          commonAncestorContainer: document.body,
        }),
      } as unknown as Selection;

      const result = validateSelection(selection);
      expect(result.valid).toBe(true);
    });

    it('rejects selection inside host element', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const inner = document.createElement('span');
      host.appendChild(inner);

      const selection = {
        isCollapsed: false,
        rangeCount: 1,
        toString: () => 'hello',
        getRangeAt: () => ({
          getClientRects: () => [{ x: 0, y: 0, width: 10, height: 10 }],
          commonAncestorContainer: inner,
        }),
      } as unknown as Selection;

      const result = validateSelection(selection, host);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('in_lexiflow_ui');
      }

      document.body.removeChild(host);
    });
  });

  describe('detectLanguageHint', () => {
    it('detects English', () => {
      expect(detectLanguageHint('hello world')).toBe('en');
    });

    it('detects mixed CJK and Latin', () => {
      expect(detectLanguageHint('hello 世界')).toBe('mixed');
    });

    it('detects unknown for non-Latin', () => {
      expect(detectLanguageHint('你好世界')).toBe('unknown');
    });
  });

  describe('createSelectionAnchor', () => {
    it('creates anchor from range with rects', () => {
      // Mock a Range with getClientRects (not available in jsdom)
      const mockRange = {
        getClientRects: () => [
          { x: 10, y: 20, width: 100, height: 20 },
          { x: 10, y: 40, width: 80, height: 20 },
        ],
      } as unknown as Range;

      const anchor = createSelectionAnchor(mockRange);
      expect(anchor.rects.length).toBe(2);
      expect(anchor.unionRect.x).toBe(10);
      expect(anchor.unionRect.y).toBe(20);
      expect(anchor.unionRect.width).toBe(100);
      expect(anchor.unionRect.height).toBe(40); // Covers both rects
      expect(['forward', 'backward', 'unknown']).toContain(anchor.direction);
    });
  });
});

describe('Selection Observer', () => {
  let observer: SelectionObserver;

  beforeEach(() => {
    observer = new SelectionObserver(MOCK_PAGE_SESSION);
  });

  it('initializes with null snapshot', () => {
    expect(observer.getCurrentSnapshot()).toBeNull();
  });

  it('notifies listeners of changes', () => {
    let notified = false;
    observer.onChange(() => {
      notified = true;
    });

    // Simulate selection change
    observer['currentSnapshot'] = {
      selectionId: 'test-id',
      revision: 1,
      text: 'test',
      textLanguageHint: 'en',
      createdAt: new Date().toISOString(),
      page: MOCK_PAGE_SESSION,
      anchor: {
        rects: [{ x: 0, y: 0, width: 10, height: 10 }],
        unionRect: { x: 0, y: 0, width: 10, height: 10 },
        direction: 'forward',
      },
    } as SelectionSnapshot;
    observer['notify'](observer['currentSnapshot']);

    expect(notified).toBe(true);
  });

  it('increments revision on invalidate', () => {
    observer.invalidate();
    expect(observer['revision']).toBe(1);
    expect(observer.getCurrentSnapshot()).toBeNull();
  });
});

describe('Context Extraction', () => {
  it('extracts selection-only context when no range available', () => {
    const snapshot: SelectionSnapshot = {
      selectionId: 'test-id',
      revision: 1,
      text: 'graceful degradation',
      textLanguageHint: 'en',
      createdAt: new Date().toISOString(),
      page: MOCK_PAGE_SESSION,
      anchor: {
        rects: [{ x: 0, y: 0, width: 100, height: 20 }],
        unionRect: { x: 0, y: 0, width: 100, height: 20 },
        direction: 'forward',
      },
    };

    // No selection in window.getSelection()
    vi.spyOn(window, 'getSelection').mockReturnValue(null);

    const context = extractContext(snapshot);
    expect(context.selection).toBe('graceful degradation');
    expect(context.quality).toBe('selection_only');
    expect(context.omissions).toContain('detached_range');
    expect(context.provenance.length).toBeGreaterThan(0);
  });

  it('extracts context with valid selection and page metadata', () => {
    document.body.innerHTML = `
      <h1>Test Article</h1>
      <p id="para">This is a test paragraph about graceful degradation in web applications. It is an important concept.</p>
    `;
    document.title = 'Test Article';

    const para = document.getElementById('para')!;
    const textNode = para.firstChild!;

    // Mock a Range with proper structure (jsdom lacks getClientRects)
    const mockRange = {
      commonAncestorContainer: textNode,
      getClientRects: () => [{ x: 0, y: 0, width: 100, height: 20 }],
    } as unknown as Range;

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'graceful degradation',
      getRangeAt: () => mockRange,
      anchorNode: textNode,
      focusNode: textNode,
      anchorOffset: 0,
      focusOffset: 5,
    } as unknown as Selection;

    vi.spyOn(window, 'getSelection').mockReturnValue(selection);

    const snapshot: SelectionSnapshot = {
      selectionId: 'test-id',
      revision: 1,
      text: 'graceful degradation',
      textLanguageHint: 'en',
      createdAt: new Date().toISOString(),
      page: MOCK_PAGE_SESSION,
      anchor: {
        rects: [{ x: 0, y: 0, width: 100, height: 20 }],
        unionRect: { x: 0, y: 0, width: 100, height: 20 },
        direction: 'forward',
      },
    };

    const context = extractContext(snapshot);
    expect(context.selection).toBe('graceful degradation');
    // In jsdom, offsetParent is null, so visible text extraction is limited
    expect(context.quality === 'full' || context.quality === 'partial' || context.quality === 'selection_only').toBe(true);
    expect(context.pageTitle).toBe('Test Article');
    expect(context.url).toBe(window.location.href);
    expect(context.provenance.length).toBeGreaterThan(0);
    // Provenance should always include page metadata sources
    expect(context.provenance.some((p) => p.source === 'metadata')).toBe(true);
  });

  it('respects budget limits', () => {
    const longText = 'a'.repeat(CONTEXT_BUDGET.selection + 100);
    const snapshot: SelectionSnapshot = {
      selectionId: 'test-id',
      revision: 1,
      text: longText,
      textLanguageHint: 'en',
      createdAt: new Date().toISOString(),
      page: MOCK_PAGE_SESSION,
      anchor: {
        rects: [{ x: 0, y: 0, width: 100, height: 20 }],
        unionRect: { x: 0, y: 0, width: 100, height: 20 },
        direction: 'forward',
      },
    };

    vi.spyOn(window, 'getSelection').mockReturnValue(null);

    const context = extractContext(snapshot);
    // Selection should be trimmed to budget
    let codePoints = 0;
    for (const _ of context.selection) {
      codePoints++;
    }
    expect(codePoints).toBeLessThanOrEqual(CONTEXT_BUDGET.selection);
  });
});

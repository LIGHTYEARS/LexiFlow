import type { SelectionSnapshot } from './selection-validator';
import {
  validateSelection,
  createSelectionAnchor,
  detectLanguageHint,
} from './selection-validator';
import type { PageSessionRef } from '@shared/protocol/page-session';
import { normalizeForDisplay } from '@shared/utils/normalize';

/**
 * SelectionObserver — listens for selection changes and notifies callbacks.
 * Does NOT judge learning value. See technical-design/03 §5.
 */
export class SelectionObserver {
  private listeners: Array<(snapshot: SelectionSnapshot | null) => void> = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSnapshot: SelectionSnapshot | null = null;
  private revision = 0;
  private hostElement: HTMLElement | undefined;
  private pageSession: PageSessionRef;

  // Debounce delay (ms) — see technical-design/03 §6 (120ms)
  static readonly STABLE_DELAY = 120;

  constructor(pageSession: PageSessionRef, hostElement?: HTMLElement) {
    this.pageSession = pageSession;
    this.hostElement = hostElement;
  }

  /**
   * Start observing selection changes.
   */
  start(): void {
    document.addEventListener('selectionchange', this.handleSelectionChange);
  }

  /**
   * Stop observing and clean up.
   */
  stop(): void {
    document.removeEventListener('selectionchange', this.handleSelectionChange);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.currentSnapshot = null;
    this.listeners = [];
  }

  /**
   * Subscribe to selection changes.
   */
  onChange(listener: (snapshot: SelectionSnapshot | null) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Get the current snapshot (if any).
   */
  getCurrentSnapshot(): SelectionSnapshot | null {
    return this.currentSnapshot;
  }

  /**
   * Invalidate the current snapshot (e.g., after user dismisses).
   */
  invalidate(): void {
    this.currentSnapshot = null;
    this.revision++;
  }

  private handleSelectionChange = (): void => {
    // Clear any pending debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Debounce: wait for selection to stabilize
    this.debounceTimer = setTimeout(() => {
      this.processSelection();
    }, SelectionObserver.STABLE_DELAY);
  };

  private processSelection(): void {
    const selection = window.getSelection();

    // Validate
    const validation = validateSelection(selection, this.hostElement);
    if (!validation.valid || !selection) {
      this.currentSnapshot = null;
      this.notify(null);
      return;
    }

    // Create snapshot
    const range = selection.getRangeAt(0);
    const text = normalizeForDisplay(selection.toString());

    this.revision++;
    const snapshot: SelectionSnapshot = {
      selectionId: crypto.randomUUID(),
      revision: this.revision,
      text,
      textLanguageHint: detectLanguageHint(text),
      createdAt: new Date().toISOString(),
      page: this.pageSession,
      anchor: createSelectionAnchor(range),
    };

    this.currentSnapshot = snapshot;
    this.notify(snapshot);
  }

  private notify(snapshot: SelectionSnapshot | null): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

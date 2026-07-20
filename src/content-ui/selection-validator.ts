/**
 * Selection validation rules.
 * These are deterministic — no model calls. See technical-design/03 §7.
 */

import type { PageSessionRef } from '@shared/protocol/page-session';

/**
 * Selection anchor for positioning the trigger button and popover.
 */
export type SelectionAnchor = {
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  unionRect: { x: number; y: number; width: number; height: number };
  direction: 'forward' | 'backward' | 'unknown';
};

/**
 * Immutable snapshot of a selection at a point in time.
 * Once created, the text and anchor are frozen (DOM changes don't modify it).
 */
export type SelectionSnapshot = {
  selectionId: string;
  revision: number;
  text: string;
  textLanguageHint: 'en' | 'mixed' | 'unknown';
  createdAt: string;
  page: PageSessionRef;
  anchor: SelectionAnchor;
};

/**
 * Result of validating a selection.
 */
export type ValidationResult =
  | { valid: true; reason?: undefined }
  | { valid: false; reason: ValidationFailureReason };

export type ValidationFailureReason =
  | 'empty'
  | 'too_long'
  | 'too_short'
  | 'no_latin'
  | 'collapsed'
  | 'multiple_ranges'
  | 'in_lexiflow_ui'
  | 'in_form_element'
  | 'invalid_range'
  | 'unsupported_element';

/**
 * Minimum and maximum selection length (Unicode code points).
 * See technical-design/03 §7.
 */
export const MIN_SELECTION_LENGTH = 1;
export const MAX_SELECTION_LENGTH = 500;

/**
 * Validate a browser Selection object against LexiFlow rules.
 */
export function validateSelection(
  selection: Selection | null,
  hostElement?: HTMLElement,
): ValidationResult {
  // Must exist
  if (!selection) {
    return { valid: false, reason: 'empty' };
  }

  // Must not be collapsed (empty selection)
  if (selection.isCollapsed) {
    return { valid: false, reason: 'collapsed' };
  }

  // Must have exactly one range
  if (selection.rangeCount !== 1) {
    return { valid: false, reason: 'multiple_ranges' };
  }

  // Get the text
  const text = selection.toString();
  const trimmed = text.trim();

  // Must not be empty after trim
  if (trimmed.length === 0) {
    return { valid: false, reason: 'empty' };
  }

  // Must contain at least one Latin letter
  if (!/[a-zA-Z]/.test(trimmed)) {
    return { valid: false, reason: 'no_latin' };
  }

  // Length check (Unicode code points, not UTF-16 code units)
  let codePoints = 0;
  for (const _ of trimmed) {
    codePoints++;
  }

  if (codePoints < MIN_SELECTION_LENGTH) {
    return { valid: false, reason: 'too_short' };
  }

  if (codePoints > MAX_SELECTION_LENGTH) {
    return { valid: false, reason: 'too_long' };
  }

  // Must not be inside LexiFlow UI
  if (hostElement) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element =
      container instanceof HTMLElement
        ? container
        : container.parentElement;
    if (element && hostElement.contains(element)) {
      return { valid: false, reason: 'in_lexiflow_ui' };
    }
  }

  // Must not be in form elements (input, textarea, password)
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const ancestorEl =
    ancestor instanceof HTMLElement
      ? ancestor
      : ancestor.parentElement;
  if (ancestorEl) {
    const tagName = ancestorEl.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return { valid: false, reason: 'in_form_element' };
    }
    // Check for contenteditable (selection-only downgrade handled at extract level)
    if (ancestorEl.isContentEditable) {
      // Allow but mark as editable (handled in context extraction)
      return { valid: true };
    }
  }

  // Range must have valid rects
  const rects = range.getClientRects();
  if (rects.length === 0) {
    return { valid: false, reason: 'invalid_range' };
  }

  // Check that at least one rect has non-zero area
  const hasValidRect = Array.from(rects).some(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (!hasValidRect) {
    return { valid: false, reason: 'invalid_range' };
  }

  return { valid: true };
}

/**
 * Detect language hint from text.
 */
export function detectLanguageHint(text: string): 'en' | 'mixed' | 'unknown' {
  const hasLatin = /[a-zA-Z]/.test(text);
  const hasCjk = /[一-鿿㐀-䶿]/.test(text);

  if (hasLatin && hasCjk) {
    return 'mixed';
  }
  if (hasLatin) {
    return 'en';
  }
  return 'unknown';
}

/**
 * Create a SelectionAnchor from a Range.
 */
export function createSelectionAnchor(range: Range): SelectionAnchor {
  const rects = Array.from(range.getClientRects()).map((rect) => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }));

  // Compute union rect
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const rect of rects) {
    if (rect.width > 0 && rect.height > 0) {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
  }

  // Fallback if no valid rects
  if (minX === Infinity) {
    const firstRect = rects[0];
    minX = firstRect?.x ?? 0;
    minY = firstRect?.y ?? 0;
    maxX = (firstRect?.x ?? 0) + (firstRect?.width ?? 0);
    maxY = (firstRect?.y ?? 0) + (firstRect?.height ?? 0);
  }

  const unionRect = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  // Determine direction
  let direction: SelectionAnchor['direction'] = 'unknown';
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (anchorNode && focusNode) {
      const position = anchorNode.compareDocumentPosition(focusNode);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        direction = 'forward';
      } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        direction = 'backward';
      } else {
        // Same node — check offsets
        direction =
          selection.anchorOffset <= selection.focusOffset ? 'forward' : 'backward';
      }
    }
  }

  return { rects, unionRect, direction };
}

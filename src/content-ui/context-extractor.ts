import type { SelectionSnapshot } from './selection-validator';

/**
 * Context evidence extracted from the page around a selection.
 * See technical-design/03 §10.
 */
export type ContextEvidence = {
  selection: string;
  sentenceBefore?: string;
  sentenceContaining?: string;
  sentenceAfter?: string;
  paragraphExcerpt?: string;
  nearestHeading?: string;
  pageTitle: string;
  url: string;
  canonicalUrl?: string;
  siteName?: string;
  extractedAt: string;
  quality: 'full' | 'partial' | 'selection_only';
  omissions: Array<
    | 'dynamic_dom'
    | 'editable'
    | 'protected_page'
    | 'no_article'
    | 'budget_exceeded'
    | 'detached_range'
  >;
  provenance: Array<{ field: string; source: 'page_dom' | 'metadata' | 'derived' }>;
};

/**
 * Budget limits for context extraction (Unicode code points).
 * See technical-design/03 §10.3.
 */
export const CONTEXT_BUDGET = {
  selection: 500,
  adjacentSentences: 1200,
  paragraph: 1500,
  totalPageText: 3000,
} as const;

// Elements to exclude from context extraction
const EXCLUDE_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'NAV',
  'FOOTER',
  'ASIDE',
  'HEADER',
  'FORM',
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'SVG',
  'CANVAS',
]);

// Semantic container elements for text extraction
const CONTAINER_TAGS = new Set([
  'P',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TD',
  'TH',
  'ARTICLE',
  'SECTION',
  'DIV',
]);

/**
 * Extract context evidence from the page around a selection.
 * Reads ONLY the live DOM — no network calls, no model requests.
 */
export function extractContext(snapshot: SelectionSnapshot): ContextEvidence {
  const omissions: ContextEvidence['omissions'] = [];
  const provenance: ContextEvidence['provenance'] = [];

  // Get the selection's Range
  const selection = window.getSelection();
  let range: Range | null = null;

  if (selection && selection.rangeCount > 0) {
    range = selection.getRangeAt(0);
  }

  // If we can't get a range (detached), return selection-only
  if (!range) {
    omissions.push('detached_range');
    return buildSelectionOnly(snapshot, omissions);
  }

  // Check for editable content
  const ancestor = range.commonAncestorContainer;
  const ancestorEl =
    ancestor.nodeType === Node.ELEMENT_NODE
      ? (ancestor as HTMLElement)
      : ancestor.parentElement;

  if (ancestorEl?.isContentEditable) {
    omissions.push('editable');
    // For editable content, only return the selection itself
    return buildSelectionOnly(snapshot, omissions);
  }

  // Extract context from DOM neighborhood
  const sentenceContaining = extractContainingSentence(range);
  const { sentenceBefore, sentenceAfter } = extractAdjacentSentences(range);
  const paragraphExcerpt = extractParagraphExcerpt(range);
  const nearestHeading = extractNearestHeading(range);

  // Get page metadata
  const pageTitle = document.title || '';
  const url = window.location.href;
  const canonicalUrl = extractCanonicalUrl();
  const siteName = extractSiteName();

  // Build provenance
  provenance.push({ field: 'selection', source: 'page_dom' });
  if (sentenceContaining) provenance.push({ field: 'sentenceContaining', source: 'page_dom' });
  if (sentenceBefore) provenance.push({ field: 'sentenceBefore', source: 'page_dom' });
  if (sentenceAfter) provenance.push({ field: 'sentenceAfter', source: 'page_dom' });
  if (paragraphExcerpt) provenance.push({ field: 'paragraphExcerpt', source: 'page_dom' });
  if (nearestHeading) provenance.push({ field: 'nearestHeading', source: 'page_dom' });
  provenance.push({ field: 'pageTitle', source: 'metadata' });
  provenance.push({ field: 'url', source: 'metadata' });

  // Determine quality
  let quality: ContextEvidence['quality'] = 'full';
  if (omissions.length > 0 || !sentenceContaining) {
    quality = 'partial';
  }
  if (!sentenceContaining && !paragraphExcerpt) {
    quality = 'selection_only';
  }

  // Apply budget trimming
  const evidence: ContextEvidence = {
    selection: trimToBudget(snapshot.text, CONTEXT_BUDGET.selection),
    sentenceBefore: sentenceBefore
      ? trimToBudget(sentenceBefore, CONTEXT_BUDGET.adjacentSentences)
      : undefined,
    sentenceContaining: sentenceContaining
      ? trimToBudget(sentenceContaining, CONTEXT_BUDGET.adjacentSentences)
      : undefined,
    sentenceAfter: sentenceAfter
      ? trimToBudget(sentenceAfter, CONTEXT_BUDGET.adjacentSentences)
      : undefined,
    paragraphExcerpt: paragraphExcerpt
      ? trimToBudget(paragraphExcerpt, CONTEXT_BUDGET.paragraph)
      : undefined,
    nearestHeading,
    pageTitle,
    url,
    canonicalUrl,
    siteName,
    extractedAt: new Date().toISOString(),
    quality,
    omissions,
    provenance,
  };

  // Check total budget
  const totalText = [
    evidence.selection,
    evidence.sentenceBefore,
    evidence.sentenceContaining,
    evidence.sentenceAfter,
    evidence.paragraphExcerpt,
  ]
    .filter(Boolean)
    .join('');

  if (countCodePoints(totalText) > CONTEXT_BUDGET.totalPageText) {
    omissions.push('budget_exceeded');
    evidence.quality = 'partial';
  }

  return evidence;
}

/**
 * Build a selection-only context (when full extraction is not possible).
 */
function buildSelectionOnly(
  snapshot: SelectionSnapshot,
  omissions: ContextEvidence['omissions'],
): ContextEvidence {
  return {
    selection: trimToBudget(snapshot.text, CONTEXT_BUDGET.selection),
    pageTitle: document.title || '',
    url: window.location.href,
    extractedAt: new Date().toISOString(),
    quality: 'selection_only',
    omissions,
    provenance: [
      { field: 'selection', source: 'page_dom' },
      { field: 'pageTitle', source: 'metadata' },
      { field: 'url', source: 'metadata' },
    ],
  };
}

/**
 * Extract the sentence containing the selection.
 */
function extractContainingSentence(range: Range): string | undefined {
  const container = range.commonAncestorContainer;
  const text = getVisibleText(container);
  if (!text) return undefined;

  // Use Intl.Segmenter for sentence segmentation if available
  if ('Intl' in window && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
      const segments = Array.from(segmenter.segment(text));
      // Find the segment containing the selection's start
      const selectedText = range.toString();
      for (const segment of segments) {
        if (segment.segment.includes(selectedText.slice(0, 20))) {
          return segment.segment.trim();
        }
      }
      // Fallback: return the segment containing the first word
      if (segments.length > 0) {
        return segments[0].segment.trim();
      }
    } catch {
      // Intl.Segmenter failed, fall through to simple extraction
    }
  }

  // Simple fallback: split by sentence-ending punctuation
  const sentences = text.split(/(?<=[.!?])\s+/);
  const selectedText = range.toString();
  for (const sentence of sentences) {
    if (sentence.includes(selectedText.slice(0, 20))) {
      return sentence.trim();
    }
  }

  return text.trim().slice(0, 500);
}

/**
 * Extract sentences before and after the containing sentence.
 */
function extractAdjacentSentences(range: Range): {
  sentenceBefore?: string;
  sentenceAfter?: string;
} {
  const container = range.commonAncestorContainer;
  const text = getVisibleText(container);
  if (!text) return {};

  if ('Intl' in window && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
      const segments = Array.from(segmenter.segment(text));
      const selectedText = range.toString();

      let currentIndex = -1;
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].segment.includes(selectedText.slice(0, 20))) {
          currentIndex = i;
          break;
        }
      }

      if (currentIndex === -1) return {};

      return {
        sentenceBefore:
          currentIndex > 0 ? segments[currentIndex - 1].segment.trim() : undefined,
        sentenceAfter:
          currentIndex < segments.length - 1
            ? segments[currentIndex + 1].segment.trim()
            : undefined,
      };
    } catch {
      // Fall through
    }
  }

  return {};
}

/**
 * Extract the paragraph excerpt containing the selection.
 */
function extractParagraphExcerpt(range: Range): string | undefined {
  // Walk up to find the nearest paragraph-like container
  let element: HTMLElement | null =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement;

  while (element && !CONTAINER_TAGS.has(element.tagName)) {
    element = element.parentElement;
    if (!element) break;
    // Don't go beyond the article/main container
    if (element.tagName === 'BODY') break;
  }

  if (!element) return undefined;

  const text = getVisibleText(element);
  if (!text) return undefined;

  return text.trim();
}

/**
 * Find the nearest heading (h1-h6) above the selection.
 */
function extractNearestHeading(range: Range): string | undefined {
  let element: HTMLElement | null =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement;

  while (element && element !== document.body) {
    const heading = element.querySelector?.('h1, h2, h3, h4, h5, h6');
    if (heading) {
      return heading.textContent?.trim() || undefined;
    }
    // Check if the element itself is a heading
    if (/^H[1-6]$/.test(element.tagName)) {
      return element.textContent?.trim() || undefined;
    }
    element = element.parentElement;
  }

  return undefined;
}

/**
 * Extract canonical URL from the page.
 */
function extractCanonicalUrl(): string | undefined {
  const canonical = document.querySelector('link[rel="canonical"]');
  const href = canonical?.getAttribute('href');
  if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
    return href;
  }
  return undefined;
}

/**
 * Extract site name from the page (from meta tags or hostname).
 */
function extractSiteName(): string | undefined {
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) {
    return ogSiteName.getAttribute('content') || undefined;
  }
  return undefined;
}

/**
 * Get visible text from a node, excluding hidden elements and excluded tags.
 */
function getVisibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;

  // Check if element is hidden
  if (element.offsetParent === null && element.tagName !== 'BODY') {
    return '';
  }

  // Check aria-hidden
  if (element.getAttribute('aria-hidden') === 'true') {
    return '';
  }

  // Exclude certain tags
  if (EXCLUDE_TAGS.has(element.tagName)) {
    return '';
  }

  // Recursively collect text from child nodes
  let text = '';
  for (const child of Array.from(element.childNodes)) {
    text += getVisibleText(child);
  }

  return text;
}

/**
 * Trim text to a budget of Unicode code points.
 */
function trimToBudget(text: string, maxCodePoints: number): string {
  let codePoints = 0;
  let result = '';
  for (const char of text) {
    if (codePoints >= maxCodePoints) break;
    result += char;
    codePoints++;
  }
  return result;
}

/**
 * Count Unicode code points in a string.
 */
function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) {
    count++;
  }
  return count;
}

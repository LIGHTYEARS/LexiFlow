import React from 'react';

/**
 * SelectionTrigger — lightweight trigger button shown near a selection.
 * See technical-design/03 §2, §9.
 *
 * This button does NOT trigger any model request. It only appears after a
 * selection stabilizes. The actual explanation starts when the user clicks it.
 */
export interface SelectionTriggerProps {
  /** Position (top-left corner of the selection union rect) */
  position: { x: number; y: number };
  /** Click handler */
  onTrigger: () => void;
  /** Keyboard shortcut hint for aria-label */
  shortcutHint?: string;
}

export const SelectionTrigger: React.FC<SelectionTriggerProps> = ({
  position,
  onTrigger,
  shortcutHint,
}) => {
  return (
    <button
      type="button"
      aria-label={
        shortcutHint
          ? `用 LexiFlow 解释选中文本 (${shortcutHint})`
          : '用 LexiFlow 解释选中文本'
      }
      title="用 LexiFlow 解释"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onTrigger();
      }}
      onMouseDown={(e) => {
        // Prevent selection collapse on click
        e.preventDefault();
      }}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y - 36}px`,
        zIndex: 2147483647,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '6px',
        border: '1px solid #e0e0e0',
        background: '#ffffff',
        color: '#1a1a1a',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        lineHeight: '1.4',
        userSelect: 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: '16px',
          height: '16px',
          borderRadius: '3px',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          flexShrink: 0,
        }}
      />
      LexiFlow
    </button>
  );
};

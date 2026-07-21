import React from 'react';
import type { CardType, CardRelationType } from '@domain/types';

/**
 * ExplanationPopover — the explanation popover shown after explicit trigger.
 * See technical-design/03 §7, §9.
 *
 * Shows:
 * - Selected text
 * - Loading skeleton (while explaining)
 * - Explanation result or failure state
 * - Actions: Save, Expand, Ignore/Close
 */

export type PopoverState = 'loading' | 'result' | 'failure';

export interface ExplanationContent {
  type?: CardType;
  chineseMeaning?: string;
  englishMeaning?: string;
  fullExplanation?: string;
  contextMeaning?: string;
  examples?: string[];
  similarCards?: Array<{ id: string; text: string; relation: CardRelationType }>;
}

export interface ExplanationPopoverProps {
  state: PopoverState;
  selectedText: string;
  content?: ExplanationContent;
  error?: string;
  saveFeedback?: string;
  position: { x: number; y: number };
  onSave: () => void;
  onSaveToInbox: () => void;
  onExpand: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export const ExplanationPopover: React.FC<ExplanationPopoverProps> = ({
  state,
  selectedText,
  content,
  error,
  saveFeedback,
  position,
  onSave,
  onSaveToInbox,
  onExpand,
  onClose,
  onRetry,
}) => {
  return (
    <div
      role="dialog"
      aria-label="LexiFlow explanation"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 2147483647,
        width: '380px',
        maxHeight: 'min(70vh, 640px)',
        overflow: 'auto',
        borderRadius: '8px',
        border: '1px solid #e0e0e0',
        background: '#ffffff',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        lineHeight: '1.5',
        color: '#1a1a1a',
      }}
    >
      {/* Header with selected text */}
      <div
        style={{
          marginBottom: '12px',
          paddingBottom: '12px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <div
          style={{
            fontSize: '12px',
            color: '#666',
            marginBottom: '4px',
          }}
        >
          选中文本
        </div>
        <div
          style={{
            fontSize: '15px',
            fontWeight: 500,
            color: '#1a1a1a',
          }}
        >
          {selectedText}
        </div>
      </div>

      {/* Loading state */}
      {state === 'loading' && (
        <div style={{ padding: '16px 0' }}>
          <div
            style={{
              height: '12px',
              background: '#f0f0f0',
              borderRadius: '4px',
              marginBottom: '8px',
              width: '80%',
            }}
          />
          <div
            style={{
              height: '12px',
              background: '#f0f0f0',
              borderRadius: '4px',
              marginBottom: '8px',
              width: '60%',
            }}
          />
          <div
            style={{
              height: '12px',
              background: '#f0f0f0',
              borderRadius: '4px',
              width: '70%',
            }}
          />
          <div
            style={{
              marginTop: '12px',
              fontSize: '12px',
              color: '#999',
            }}
          >
            正在解释...
          </div>
        </div>
      )}

      {/* Result state */}
      {state === 'result' && content && (
        <div>
          {content.type && (
            <div style={{ marginBottom: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: '#eef2ff',
                  color: '#4338ca',
                  fontSize: '12px',
                  fontWeight: 500,
                }}
              >
                {content.type}
              </span>
            </div>
          )}

          {content.chineseMeaning && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>中文释义</div>
              <div>{content.chineseMeaning}</div>
            </div>
          )}

          {content.englishMeaning && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>English meaning</div>
              <div>{content.englishMeaning}</div>
            </div>
          )}

          {content.contextMeaning && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>文中含义</div>
              <div>{content.contextMeaning}</div>
            </div>
          )}

          {content.similarCards && content.similarCards.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>相似卡片</div>
              {content.similarCards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    padding: '4px 8px',
                    background: '#f9fafb',
                    borderRadius: '4px',
                    marginTop: '4px',
                    fontSize: '13px',
                  }}
                >
                  {card.text}
                  <span style={{ color: '#999', marginLeft: '4px' }}>
                    ({card.relation})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Failure state */}
      {state === 'failure' && (
        <div style={{ padding: '8px 0' }}>
          <div
            style={{
              padding: '8px 12px',
              background: '#fef2f2',
              borderRadius: '4px',
              color: '#dc2626',
              fontSize: '13px',
              marginBottom: '12px',
            }}
          >
            {error || '解释失败，请重试或保存原文到 Inbox'}
          </div>
        </div>
      )}

      {/* Save feedback */}
      {saveFeedback && (
        <div
          style={{
            padding: '8px 12px',
            background: '#f0fdf4',
            borderRadius: '4px',
            color: '#16a34a',
            fontSize: '13px',
            marginBottom: '12px',
          }}
        >
          {saveFeedback}
        </div>
      )}

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid #f0f0f0',
        }}
      >
        {state !== 'loading' && (
          <>
            <button
              type="button"
              onClick={onExpand}
              title="展开详情"
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid #e0e0e0',
                background: '#fff',
                color: '#333',
                fontSize: '13px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ↗
            </button>
            <button
              type="button"
              onClick={onSave}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                background: '#4f46e5',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              保存
            </button>
            <button
              type="button"
              onClick={onSaveToInbox}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #e0e0e0',
                background: '#fff',
                color: '#333',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              存到 Inbox
            </button>
          </>
        )}
        {state === 'failure' && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #e0e0e0',
              background: '#fff',
              color: '#333',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            background: 'transparent',
            color: '#666',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

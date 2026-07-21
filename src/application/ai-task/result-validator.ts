import { getOutputSchema } from './schemas';
import type { AiTaskResult, AiTaskType } from '@shared/protocol/protocol-map';

/**
 * StructuredResultValidator — validates terminal model output against Zod schema.
 * Only accepts schema-passing terminal state; incremental text (deltas) must NOT be saved.
 * See technical-design/05 §4 (StructuredResultValidator) and §6 (state machine).
 */

export interface ValidationResult<T = unknown> {
  valid: boolean;
  result?: AiTaskResult<T>;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Validate a raw model output against the task type's output schema.
 * Returns a typed AiTaskResult on success, or an error on failure.
 * On schema failure: INVALID_MODEL_OUTPUT — never fabricate missing fields.
 */
export function validateResult(
  taskType: AiTaskType | string,
  taskId: string,
  promptVersion: string,
  raw: unknown,
): ValidationResult {
  const schema = getOutputSchema(taskType);
  if (!schema) {
    return {
      valid: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: `No output schema defined for task type: ${taskType}`,
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errorCode: 'INVALID_MODEL_OUTPUT',
      errorMessage: `Model output failed schema validation: ${parsed.error.message}`,
    };
  }

  return {
    valid: true,
    result: {
      taskId,
      schemaVersion: 1,
      value: parsed.data,
      provenance: {
        kind: 'model-generated',
        taskId,
        promptVersion,
      },
    },
  };
}

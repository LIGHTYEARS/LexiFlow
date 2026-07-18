import { validateEnvelope, createError, fail } from '@shared/protocol/envelope';
import type { AppResult, AppError, MessageEnvelope } from '@shared/protocol/envelope';
import { validateSender, validatePayloadSize, mapError } from './browser-runtime';

/**
 * Message handler type — processes a validated envelope and returns an AppResult.
 */
export type MessageHandler<TInput = unknown, TOutput = unknown> = (
  payload: TInput,
  envelope: MessageEnvelope,
  sender: chrome.runtime.MessageSender,
) => Promise<AppResult<TOutput>> | AppResult<TOutput>;

/**
 * Registry of message handlers by message type.
 * The background service worker uses this to route incoming messages.
 */
class MessageHandlerRegistry {
  private handlers = new Map<string, MessageHandler>();

  /**
   * Register a handler for a message type.
   */
  register<TInput, TOutput>(
    type: string,
    handler: MessageHandler<TInput, TOutput>,
  ): void {
    if (this.handlers.has(type)) {
      console.warn(`[LexiFlow] Handler already registered for: ${type}`);
    }
    this.handlers.set(type, handler as MessageHandler);
  }

  /**
   * Check if a handler exists for the given type.
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Get all registered message types.
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Handle an incoming message: validate envelope, verify sender, dispatch to handler.
   * This is the single entry point for all background message processing.
   */
  async handle(
    rawEnvelope: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<AppResult<unknown>> {
    // Step 1: Validate envelope structure
    let envelope: MessageEnvelope;
    try {
      envelope = validateEnvelope(rawEnvelope);
    } catch (error) {
      return fail('unknown', error as AppError);
    }

    // Step 2: Validate sender
    const senderCheck = validateSender(sender);
    if (!senderCheck.valid) {
      return fail(envelope.requestId, senderCheck.error!);
    }

    // Step 3: Validate payload size
    const sizeCheck = validatePayloadSize(envelope.payload);
    if (!sizeCheck.valid) {
      return fail(envelope.requestId, sizeCheck.error!);
    }

    // Step 4: Find and invoke handler
    const handler = this.handlers.get(envelope.type);
    if (!handler) {
      return fail(
        envelope.requestId,
        createError('INVALID_INPUT', `Unknown message type: ${envelope.type}`, false),
      );
    }

    // Step 5: Execute handler with error mapping
    try {
      return await handler(envelope.payload, envelope, sender);
    } catch (error) {
      return fail(envelope.requestId, mapError(error));
    }
  }
}

/**
 * Singleton registry instance.
 */
export const messageRegistry = new MessageHandlerRegistry();

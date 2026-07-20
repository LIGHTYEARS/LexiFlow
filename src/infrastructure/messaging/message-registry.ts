import { validateEnvelope, createError, fail } from '@shared/protocol/envelope';
import type { AppResult, AppError, MessageEnvelope } from '@shared/protocol/envelope';
import { validateSender, validatePayloadSize, mapError } from './browser-runtime';

/**
 * Message handler type — processes a validated envelope and returns an AppResult.
 *
 * @template TInput The expected payload type for this handler.
 * @template TOutput The output type wrapped in an AppResult.
 *
 * Handlers should be registered with explicit generic type arguments via
 * {@link MessageHandlerRegistry.register} so that input/output types are
 * preserved at the call site. The internal registry stores handlers with
 * `unknown` bounds, so the explicit types on `register` are what give the
 * handler its type safety.
 */
export type MessageHandler<TInput, TOutput> = (
  payload: TInput,
  envelope: MessageEnvelope,
  sender: chrome.runtime.MessageSender,
) => Promise<AppResult<TOutput>> | AppResult<TOutput>;

/**
 * Registry of message handlers by message type.
 * The background service worker uses this to route incoming messages.
 */
class MessageHandlerRegistry {
  private handlers = new Map<string, MessageHandler<unknown, unknown>>();

  /**
   * Register a handler for a message type.
   *
   * @template TInput The expected payload type for this handler.
   * @template TOutput The output type wrapped in an AppResult.
   */
  register<TInput, TOutput>(
    type: string,
    handler: MessageHandler<TInput, TOutput>,
  ): void {
    if (this.handlers.has(type)) {
      console.warn(`[LexiFlow] Handler already registered for: ${type}`);
    }
    // The cast is necessary: the Map stores handlers with `unknown` bounds,
    // so a handler's specific input/output types cannot be represented in the
    // stored value type. Type safety is provided by the explicit generic type
    // arguments on `register` at the call site, which preserve each handler's
    // specific input/output types.
    this.handlers.set(type, handler as MessageHandler<unknown, unknown>);
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
   *
   * @template TOutput The expected output type wrapped in an AppResult.
   *                   Defaults to `unknown`; callers may specify a more precise
   *                   type when they know the handler's return shape.
   */
  async handle<TOutput = unknown>(
    rawEnvelope: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<AppResult<TOutput>> {
    // Step 1: Validate envelope structure
    let envelope: MessageEnvelope;
    try {
      envelope = validateEnvelope(rawEnvelope);
    } catch (error) {
      // validateEnvelope throws AppError, but we verify the error's shape before
      // casting to guard against unexpected throw values (e.g. non-Error throws).
      const appError =
        error && typeof error === 'object' && 'code' in error && 'userMessage' in error
          ? (error as AppError)
          : createError('INTERNAL', 'Unexpected validation error', false);
      return fail('unknown', appError);
    }

    // Step 2: Validate sender
    const senderCheck = validateSender(sender);
    if (!senderCheck.valid) {
      return fail(envelope.requestId, senderCheck.error);
    }

    // Step 3: Validate payload size
    const sizeCheck = validatePayloadSize(envelope.payload);
    if (!sizeCheck.valid) {
      return fail(envelope.requestId, sizeCheck.error);
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
      return (await handler(envelope.payload, envelope, sender)) as AppResult<TOutput>;
    } catch (error) {
      return fail(envelope.requestId, mapError(error));
    }
  }
}

/**
 * Singleton registry instance.
 */
export const messageRegistry = new MessageHandlerRegistry();

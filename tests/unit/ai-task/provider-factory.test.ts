import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModel, testConnection, type ModelProfile } from '@adapters/litellm/provider-factory';

// Mock the AI SDK's OpenAI-compatible provider
const createOpenAICompatibleMock = vi.fn();
const chatModelMock = vi.fn();

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (...args: unknown[]) => createOpenAICompatibleMock(...args),
}));

// Mock the 'ai' module's generateText for testConnection
const generateTextMock = vi.fn();
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  generateObject: vi.fn(),
}));

const testProfile: ModelProfile = {
  id: 'test-profile',
  modelId: 'test-model-id',
  baseUrl: 'https://test.example.com/v1',
  apiKey: 'test-api-key',
};

describe('Provider Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: createOpenAICompatible returns a provider with chatModel
    createOpenAICompatibleMock.mockReturnValue({
      chatModel: chatModelMock.mockReturnValue({ id: 'mock-model' }),
    });
  });

  describe('createModel', () => {
    it('returns a model object', () => {
      const model = createModel(testProfile);
      expect(model).toBeDefined();
      expect(model).toEqual({ id: 'mock-model' });
    });

    it('calls createOpenAICompatible with correct config', () => {
      createModel(testProfile);
      expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
        name: 'litellm',
        baseURL: testProfile.baseUrl,
        apiKey: testProfile.apiKey,
      });
    });

    it('calls chatModel with the modelId from the profile', () => {
      createModel(testProfile);
      expect(chatModelMock).toHaveBeenCalledWith(testProfile.modelId);
    });

    it('uses different profile configs correctly', () => {
      const customProfile: ModelProfile = {
        id: 'custom',
        modelId: 'custom-model',
        baseUrl: 'https://custom.example.com/api',
        apiKey: 'custom-key',
      };
      createModel(customProfile);
      expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
        name: 'litellm',
        baseURL: 'https://custom.example.com/api',
        apiKey: 'custom-key',
      });
      expect(chatModelMock).toHaveBeenCalledWith('custom-model');
    });
  });

  describe('testConnection', () => {
    it('returns ok on successful connection', async () => {
      generateTextMock.mockResolvedValue({ text: 'ok' });

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(true);
      expect(result.message).toBe('Connection successful');
      expect(result.latencyMs).toBeDefined();
      expect(typeof result.latencyMs).toBe('number');
      expect(result.code).toBeUndefined();
    });

    it('calls generateText with correct parameters', async () => {
      generateTextMock.mockResolvedValue({ text: 'ok' });

      await testConnection(testProfile);
      expect(generateTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Reply with exactly: ok',
          maxOutputTokens: 10,
          temperature: 0,
        }),
      );
    });

    it('maps 401 error to PERMISSION_DENIED', async () => {
      generateTextMock.mockRejectedValue(new Error('401 Unauthorized'));

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PERMISSION_DENIED');
      expect(result.message).toBe('Authentication failed');
      expect(result.latencyMs).toBeDefined();
    });

    it('maps auth error to PERMISSION_DENIED', async () => {
      generateTextMock.mockRejectedValue(new Error('auth required'));

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PERMISSION_DENIED');
      expect(result.message).toBe('Authentication failed');
    });

    it('maps 404 error to NOT_FOUND', async () => {
      generateTextMock.mockRejectedValue(new Error('404 Not Found'));

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
      expect(result.message).toBe('Model not found');
    });

    it('maps "not found" error to NOT_FOUND', async () => {
      generateTextMock.mockRejectedValue(new Error('Model not found'));

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
      expect(result.message).toBe('Model not found');
    });

    it('maps timeout error to TIMEOUT', async () => {
      generateTextMock.mockRejectedValue(new Error('Request timeout'));

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('TIMEOUT');
      expect(result.message).toBe('Connection timed out');
    });

    it('maps ETIMEDOUT error to TIMEOUT', async () => {
      generateTextMock.mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('TIMEOUT');
      expect(result.message).toBe('Connection timed out');
    });

    it('maps generic error to MODEL_UNAVAILABLE', async () => {
      generateTextMock.mockRejectedValue(new Error('Something went wrong'));

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MODEL_UNAVAILABLE');
      expect(result.message).toBe('Connection failed');
    });

    it('handles non-Error throw (string)', async () => {
      generateTextMock.mockRejectedValue('a string error');

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MODEL_UNAVAILABLE');
      expect(result.message).toBe('Unknown error');
    });

    it('handles non-Error throw (object)', async () => {
      generateTextMock.mockRejectedValue({ some: 'object' });

      const result = await testConnection(testProfile);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('MODEL_UNAVAILABLE');
      expect(result.message).toBe('Unknown error');
    });

    it('latencyMs is a non-negative number on success', async () => {
      generateTextMock.mockResolvedValue({ text: 'ok' });

      const result = await testConnection(testProfile);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('latencyMs is a non-negative number on failure', async () => {
      generateTextMock.mockRejectedValue(new Error('fail'));

      const result = await testConnection(testProfile);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});

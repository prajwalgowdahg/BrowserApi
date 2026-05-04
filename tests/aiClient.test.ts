import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAIClient, resetAIClient, getDeploymentName } from '../src/services/aiClient.js';

// Mutable env state shared with the mock factory
const mockEnv: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  PORT: '3000',
  CHROMIUM_PATH: undefined,
  SESSION_TIMEOUT_MS: '600000',
  MAX_SESSIONS: '10',
  AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
  AZURE_OPENAI_API_KEY: 'test-api-key-123',
  AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
  AZURE_OPENAI_API_VERSION: '2024-07-01-preview',
};

vi.mock('../src/config/env.js', () => ({
  get env() {
    return mockEnv;
  },
}));

function setEnv(updates: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(updates)) {
    mockEnv[key] = value;
  }
}

describe('aiClient', () => {
  beforeEach(() => {
    resetAIClient();
    // Reset to default valid env for each test
    mockEnv.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com';
    mockEnv.AZURE_OPENAI_API_KEY = 'test-api-key-123';
    mockEnv.AZURE_OPENAI_DEPLOYMENT = 'gpt-4o';
    mockEnv.AZURE_OPENAI_API_VERSION = '2024-07-01-preview';
  });

  describe('getAIClient', () => {
    it('returns client when env vars are set', () => {
      const client = getAIClient();
      expect(client).toBeDefined();
      expect(client.chat).toBeDefined();
      expect(client.chat.completions).toBeDefined();
    });

    it('caches client on repeated calls', () => {
      const first = getAIClient();
      const second = getAIClient();
      expect(first).toBe(second);
    });

    it('throws descriptive error when AZURE_OPENAI_ENDPOINT is missing', () => {
      setEnv({ AZURE_OPENAI_ENDPOINT: undefined });
      expect(() => getAIClient()).toThrow(
        'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT environment variables.',
      );
    });

    it('throws descriptive error when AZURE_OPENAI_API_KEY is missing', () => {
      setEnv({ AZURE_OPENAI_API_KEY: undefined });
      expect(() => getAIClient()).toThrow(
        'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT environment variables.',
      );
    });

    it('throws descriptive error when AZURE_OPENAI_DEPLOYMENT is missing', () => {
      setEnv({ AZURE_OPENAI_DEPLOYMENT: undefined });
      expect(() => getAIClient()).toThrow(
        'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT environment variables.',
      );
    });
  });

  describe('resetAIClient', () => {
    it('clears cached client so next call creates a fresh one', () => {
      const first = getAIClient();
      resetAIClient();
      const second = getAIClient();
      expect(first).not.toBe(second);
    });
  });

  describe('getDeploymentName', () => {
    it('returns deployment name when configured', () => {
      expect(getDeploymentName()).toBe('gpt-4o');
    });

    it('throws when AZURE_OPENAI_DEPLOYMENT is not set', () => {
      setEnv({ AZURE_OPENAI_DEPLOYMENT: undefined });
      expect(() => getDeploymentName()).toThrow(
        'AZURE_OPENAI_DEPLOYMENT is not configured',
      );
    });
  });
});

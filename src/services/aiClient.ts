import { AzureOpenAI } from 'openai';
import { env } from '../config/env.js';

let client: AzureOpenAI | null = null;

/**
 * Lazy singleton for the Azure OpenAI client.
 * Validates env vars at call time (not import time) so Phase 1-3 tests
 * without Azure creds still pass.
 */
export function getAIClient(): AzureOpenAI {
  if (client) return client;

  const { AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT } = env;

  if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_API_KEY || !AZURE_OPENAI_DEPLOYMENT) {
    throw new Error(
      'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT environment variables.',
    );
  }

  client = new AzureOpenAI({
    endpoint: AZURE_OPENAI_ENDPOINT,
    apiKey: AZURE_OPENAI_API_KEY,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
    deployment: AZURE_OPENAI_DEPLOYMENT,
  });

  return client;
}

/**
 * Reset the cached client. For test teardown only.
 */
export function resetAIClient(): void {
  client = null;
}

/**
 * Returns the configured Azure OpenAI deployment name.
 * Throws if not set.
 */
export function getDeploymentName(): string {
  if (!env.AZURE_OPENAI_DEPLOYMENT) {
    throw new Error(
      'AZURE_OPENAI_DEPLOYMENT is not configured. Set the AZURE_OPENAI_DEPLOYMENT environment variable.',
    );
  }
  return env.AZURE_OPENAI_DEPLOYMENT;
}

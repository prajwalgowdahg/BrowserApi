import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // Browser session configuration
  CHROMIUM_PATH: z.string().min(1).optional(),
  SESSION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(600000),
  MAX_SESSIONS: z.coerce.number().int().min(1).max(50).default(10),

  // Azure OpenAI -- optional in Phase 1, required in Phase 4 (AI Element Finding)
  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_API_KEY: z.string().min(1).optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1).optional(),
  AZURE_OPENAI_API_VERSION: z.string().min(1).default('2024-07-01-preview'),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

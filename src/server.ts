import { env } from './config/env.js';
import { createApp } from './app.js';

const app = createApp();

process.on('uncaughtException', (err: Error) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

app.listen(env.PORT, () => {
  console.log('Server running on port', env.PORT);
});

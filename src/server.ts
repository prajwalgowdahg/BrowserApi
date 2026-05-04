import { env } from './config/env.js';
import { createApp } from './app.js';
import { launchBrowser, closeBrowser } from './services/browserManager.js';
import { sessionManager } from './services/sessionManager.js';

async function gracefulShutdown(signal: string) {
  console.log('Received ' + signal + '. Shutting down gracefully...');
  await sessionManager.shutdown();
  await closeBrowser();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err: Error) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

async function main() {
  await launchBrowser();

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log('Server running on port', env.PORT);
  });
}

main().catch((err) => {
  console.error('[FATAL] Startup failed:', err);
  process.exit(1);
});

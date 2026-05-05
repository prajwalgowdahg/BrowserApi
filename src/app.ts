import express from 'express';
import { healthRouter } from './routes/health.js';
import { sessionRouter } from './routes/sessions.js';
import { screenshotRouter } from './routes/screenshot.js';
import { actionsRouter } from './routes/actions.js';
import { compoundsRouter } from './routes/compounds.js';
import { notFoundHandler } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Parse JSON bodies -- must be first, before routes
  app.use(express.json());

  // Routes
  app.use('/health', healthRouter);
  app.use('/sessions', sessionRouter);
  app.use('/sessions', screenshotRouter);
  app.use('/sessions', actionsRouter);
  app.use('/sessions', compoundsRouter);

  // 404 catch-all -- after all routes, before error handler
  app.use(notFoundHandler);

  // Global error handler -- MUST be last middleware
  app.use(errorHandler);

  return app;
}

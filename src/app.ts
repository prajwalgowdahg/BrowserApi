import express from 'express';
import { healthRouter } from './routes/health.js';
import { sessionRouter } from './routes/sessions.js';
import { screenshotRouter } from './routes/screenshot.js';
import { actionsRouter } from './routes/actions.js';
import { compoundsRouter } from './routes/compounds.js';
import { v1Router } from './routes/v1.js';
import { requestLogger } from './middleware/requestLogger.js';
import { v1Access } from './middleware/v1Access.js';
import { notFoundHandler } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Parse JSON bodies -- must be first, before routes
  app.use(express.json());
  app.use(requestLogger);

  // Routes
  app.use('/health', healthRouter);
  app.use('/v1', v1Access, v1Router);
  app.use('/v1/sessions', sessionRouter);
  app.use('/v1/sessions', screenshotRouter);
  app.use('/v1/sessions', actionsRouter);
  app.use('/v1/sessions', compoundsRouter);
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

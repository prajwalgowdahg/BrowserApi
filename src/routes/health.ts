import { Router } from 'express';
import { success } from '../utils/response.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  success(res, { status: 'ok' });
});

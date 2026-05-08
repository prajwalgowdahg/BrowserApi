import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { v1Error, v1Success, type V1Status } from '../utils/v1Response.js';
import { cancelTask, resumeTask, runTask, serializeTask } from '../services/taskExecutor.js';
import { taskStore, type TaskType } from '../services/taskStore.js';
import { profileService } from '../services/profileService.js';

export const v1Router = Router();

const taskTypes = [
  'travel.flight_search',
  'travel.hotel_search',
  'shopping.product_search',
  'shopping.product_select',
  'web.form_fill',
  'web.extract',
  'web.monitor',
  'qa.flow_test',
] as const;

const runTaskSchema = z.object({
  type: z.enum(taskTypes),
  input: z.record(z.string(), z.unknown()).default({}),
  projectId: z.string().optional(),
  profileId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
});

function requestMeta(req: Request, taskId?: string, status?: V1Status, sessionId?: string) {
  return {
    requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : randomUUID(),
    projectId: typeof req.headers['x-project-id'] === 'string' ? req.headers['x-project-id'] : undefined,
    taskId,
    status,
    sessionId,
  };
}

async function runAndRespond(
  req: Request,
  res: Response,
  type: TaskType,
  input: Record<string, unknown>,
) {
  const start = Date.now();
  const task = await runTask({
    type,
    input,
    projectId: typeof req.headers['x-project-id'] === 'string' ? req.headers['x-project-id'] : undefined,
    profileId: typeof input.profileId === 'string' ? input.profileId : undefined,
    webhookUrl: typeof input.webhookUrl === 'string' ? input.webhookUrl : undefined,
  });
  return v1Success(res, serializeTask(task), {
    ...requestMeta(req, task.id, task.status, task.sessionId),
    durationMs: Date.now() - start,
  }, task.status === 'failed' ? 500 : 200);
}

v1Router.post('/tasks/run', async (req, res) => {
  const start = Date.now();
  const parsed = runTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return v1Error(res, {
      errorCode: 'VALIDATION_ERROR',
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      retryable: false,
    }, { ...requestMeta(req), durationMs: Date.now() - start }, 400);
  }

  try {
    const task = await runTask({
      ...parsed.data,
      projectId: parsed.data.projectId ?? (typeof req.headers['x-project-id'] === 'string' ? req.headers['x-project-id'] : undefined),
    });
    return v1Success(res, serializeTask(task), {
      ...requestMeta(req, task.id, task.status, task.sessionId),
      durationMs: Date.now() - start,
    }, task.status === 'failed' ? 500 : 200);
  } catch (err) {
    return v1Error(res, {
      errorCode: 'TASK_RUN_FAILED',
      message: (err as Error).message,
      retryable: true,
    }, { ...requestMeta(req), durationMs: Date.now() - start }, 500);
  }
});

v1Router.get('/tasks/:taskId', (req, res) => {
  const task = taskStore.get(req.params.taskId);
  if (!task) {
    return v1Error(res, {
      errorCode: 'TASK_NOT_FOUND',
      message: 'Task not found',
      retryable: false,
    }, requestMeta(req, req.params.taskId), 404);
  }
  return v1Success(res, serializeTask(task), requestMeta(req, task.id, task.status, task.sessionId));
});

v1Router.post('/tasks/:taskId/resume', async (req, res) => {
  try {
    const task = await resumeTask(req.params.taskId);
    return v1Success(res, serializeTask(task), requestMeta(req, task.id, task.status, task.sessionId));
  } catch (err) {
    return v1Error(res, {
      errorCode: 'TASK_RESUME_FAILED',
      message: (err as Error).message,
      retryable: true,
    }, requestMeta(req, req.params.taskId), 404);
  }
});

v1Router.post('/tasks/:taskId/cancel', async (req, res) => {
  try {
    const task = await cancelTask(req.params.taskId);
    return v1Success(res, serializeTask(task), requestMeta(req, task.id, task.status, task.sessionId));
  } catch (err) {
    return v1Error(res, {
      errorCode: 'TASK_CANCEL_FAILED',
      message: (err as Error).message,
      retryable: false,
    }, requestMeta(req, req.params.taskId), 404);
  }
});

v1Router.get('/tasks/:taskId/events', (req, res) => {
  const task = taskStore.get(req.params.taskId);
  if (!task) {
    return v1Error(res, {
      errorCode: 'TASK_NOT_FOUND',
      message: 'Task not found',
      retryable: false,
    }, requestMeta(req, req.params.taskId), 404);
  }
  return v1Success(res, { events: task.events }, requestMeta(req, task.id, task.status, task.sessionId));
});

v1Router.get('/tasks/:taskId/artifacts', (req, res) => {
  const task = taskStore.get(req.params.taskId);
  if (!task) {
    return v1Error(res, {
      errorCode: 'TASK_NOT_FOUND',
      message: 'Task not found',
      retryable: false,
    }, requestMeta(req, req.params.taskId), 404);
  }
  return v1Success(res, { artifacts: task.artifacts }, requestMeta(req, task.id, task.status, task.sessionId));
});

v1Router.post('/profiles', async (req, res) => {
  const start = Date.now();
  const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId : randomUUID();
  try {
    const profile = await profileService.ensure(profileId);
    return v1Success(res, {
      profileId: profile.profileId,
      exists: profile.exists,
    }, { ...requestMeta(req), durationMs: Date.now() - start }, 201);
  } catch (err) {
    return v1Error(res, {
      errorCode: 'PROFILE_CREATE_FAILED',
      message: (err as Error).message,
      retryable: false,
    }, { ...requestMeta(req), durationMs: Date.now() - start }, 400);
  }
});

v1Router.get('/profiles/:profileId', async (req, res) => {
  try {
    const profile = profileService.getProfile(req.params.profileId);
    return v1Success(res, {
      profileId: profile.profileId,
      exists: await profileService.exists(req.params.profileId),
    }, requestMeta(req));
  } catch (err) {
    return v1Error(res, {
      errorCode: 'PROFILE_NOT_FOUND',
      message: (err as Error).message,
      retryable: false,
    }, requestMeta(req), 404);
  }
});

v1Router.delete('/profiles/:profileId', async (req, res) => {
  try {
    await profileService.delete(req.params.profileId);
    return v1Success(res, { deleted: true, profileId: req.params.profileId }, requestMeta(req));
  } catch (err) {
    return v1Error(res, {
      errorCode: 'PROFILE_DELETE_FAILED',
      message: (err as Error).message,
      retryable: false,
    }, requestMeta(req), 400);
  }
});

v1Router.post('/profiles/:profileId/export-storage-state', async (req, res) => {
  try {
    const storageState = await profileService.exportStorageState(req.params.profileId);
    if (!storageState) {
      return v1Error(res, {
        errorCode: 'PROFILE_STORAGE_STATE_NOT_FOUND',
        message: 'No storage state has been saved for this profile yet.',
        retryable: true,
      }, requestMeta(req), 404);
    }
    return v1Success(res, { profileId: req.params.profileId, storageState }, requestMeta(req));
  } catch (err) {
    return v1Error(res, {
      errorCode: 'PROFILE_EXPORT_FAILED',
      message: (err as Error).message,
      retryable: false,
    }, requestMeta(req), 400);
  }
});

v1Router.post('/travel/flights/search', (req, res) =>
  runAndRespond(req, res, 'travel.flight_search', req.body ?? {}));

v1Router.post('/travel/hotels/search', (req, res) =>
  runAndRespond(req, res, 'travel.hotel_search', req.body ?? {}));

v1Router.post('/shopping/search', (req, res) =>
  runAndRespond(req, res, 'shopping.product_search', req.body ?? {}));

v1Router.post('/shopping/select-options', (req, res) =>
  runAndRespond(req, res, 'shopping.product_select', req.body ?? {}));

v1Router.post('/shopping/add-to-cart', (req, res) =>
  runAndRespond(req, res, 'shopping.product_select', { ...req.body, action: 'add to cart' }));

v1Router.post('/extract', (req, res) =>
  runAndRespond(req, res, 'web.extract', req.body ?? {}));

v1Router.post('/forms/fill', (req, res) =>
  runAndRespond(req, res, 'web.form_fill', req.body ?? {}));

v1Router.post('/qa/run', (req, res) =>
  runAndRespond(req, res, 'qa.flow_test', req.body ?? {}));

v1Router.post('/monitors/run', (req, res) =>
  runAndRespond(req, res, 'web.monitor', req.body ?? {}));

v1Router.get('/openapi.json', (_req, res) => {
  return res.json({
    openapi: '3.1.0',
    info: {
      title: 'BrowseAPI Platform API',
      version: '1.0.0',
    },
    paths: {
      '/v1/tasks/run': { post: { summary: 'Run a typed browser task' } },
      '/v1/tasks/{taskId}': { get: { summary: 'Get task status' } },
      '/v1/tasks/{taskId}/resume': { post: { summary: 'Resume a paused task' } },
      '/v1/tasks/{taskId}/cancel': { post: { summary: 'Cancel a task' } },
      '/v1/tasks/{taskId}/events': { get: { summary: 'Get task events' } },
      '/v1/tasks/{taskId}/artifacts': { get: { summary: 'Get task artifacts' } },
      '/v1/profiles': { post: { summary: 'Create or initialize a reusable browser profile' } },
      '/v1/profiles/{profileId}': {
        get: { summary: 'Get reusable browser profile metadata' },
        delete: { summary: 'Delete a reusable browser profile' },
      },
      '/v1/profiles/{profileId}/export-storage-state': { post: { summary: 'Export saved Playwright storage state for a profile' } },
      '/v1/travel/flights/search': { post: { summary: 'Search flights' } },
      '/v1/travel/hotels/search': { post: { summary: 'Search hotels' } },
      '/v1/shopping/search': { post: { summary: 'Search shopping sites' } },
      '/v1/shopping/select-options': { post: { summary: 'Select product options' } },
      '/v1/shopping/add-to-cart': { post: { summary: 'Prepare add-to-cart task with policy gates' } },
      '/v1/extract': { post: { summary: 'Extract structured page data' } },
      '/v1/forms/fill': { post: { summary: 'Fill a web form draft' } },
      '/v1/qa/run': { post: { summary: 'Run a browser QA flow' } },
    },
    components: {
      schemas: {
        TaskStatus: { enum: ['queued', 'running', 'needs_human', 'needs_approval', 'completed', 'blocked', 'failed', 'cancelled'] },
        Error: {
          type: 'object',
          properties: {
            errorCode: { type: 'string' },
            message: { type: 'string' },
            retryable: { type: 'boolean' },
            evidence: { type: 'array', items: { type: 'string' } },
            screenshot: { type: 'string' },
          },
        },
      },
    },
  });
});

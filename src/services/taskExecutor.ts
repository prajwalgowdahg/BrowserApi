import { sessionManager } from './sessionManager.js';
import { taskStore, type TaskRecord, type TaskType } from './taskStore.js';
import { bookingSearchHotels, flipkartSearchProduct, flipkartSelectSize, googleFlightsSearch, searchSite } from './siteAdapters.js';
import { observePage } from './pageObserver.js';
import { detectHumanCheck } from './humanCheckDetector.js';
import { screenshotPage } from '../utils/thumbnails.js';
import { evaluatePolicy } from './policyGate.js';
import { dispatchWebhook } from './webhookService.js';
import { findElementWithAI } from './cascadeFinder.js';
import { browserEventService } from './browserEventService.js';

export interface RunTaskRequest {
  type: TaskType;
  input: Record<string, unknown>;
  projectId?: string;
  profileId?: string;
  webhookUrl?: string;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function compactTask(task: TaskRecord): Omit<TaskRecord, 'events' | 'artifacts'> {
  const { events: _events, artifacts: _artifacts, ...rest } = task;
  return rest;
}

export function serializeTask(task: TaskRecord): Record<string, unknown> {
  return {
    ...compactTask(task),
    eventCount: task.events.length,
    artifactCount: task.artifacts.length,
  };
}

export async function runTask(params: RunTaskRequest): Promise<TaskRecord> {
  const task = taskStore.create(params);
  await executeTask(task.id);
  return taskStore.get(task.id)!;
}

export async function resumeTask(taskId: string): Promise<TaskRecord> {
  const task = taskStore.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (!['needs_human', 'needs_approval', 'failed'].includes(task.status)) {
    return task;
  }
  await executeTask(taskId);
  return taskStore.get(taskId)!;
}

export async function cancelTask(taskId: string): Promise<TaskRecord> {
  const task = taskStore.setStatus(taskId, 'cancelled', 'task.cancelled');
  await dispatchWebhook(task.webhookUrl, 'task.failed', task).catch(() => {});
  return task;
}

async function executeTask(taskId: string): Promise<void> {
  const task = taskStore.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const policy = evaluatePolicy({
    taskType: task.type,
    action: asString(task.input.action),
    text: JSON.stringify(task.input),
  });

  if (policy.needsApproval && task.input.approved !== true) {
    const updated = taskStore.setStatus(taskId, 'needs_approval', 'task.needs_approval', policy.evidence);
    updated.error = {
      errorCode: 'APPROVAL_REQUIRED',
      message: 'This task requires explicit user approval before continuing.',
      retryable: true,
      evidence: policy.evidence,
    };
    await dispatchWebhook(updated.webhookUrl, 'task.needs_approval', updated).catch(() => {});
    return;
  }

  let session = task.sessionId ? sessionManager.get(task.sessionId) : undefined;
  if (!session) {
    session = await sessionManager.create({ profileId: task.profileId });
    taskStore.setSession(taskId, session.id);
  }
  taskStore.setStatus(taskId, 'running', 'task.running');

  try {
    const result = await executeTypedTask(task, session.page);

    const humanCheck = await detectHumanCheck(session.page);
    if (humanCheck.required) {
      const screenshot = await screenshotPage(session.page);
      taskStore.addArtifact(taskId, 'screenshot', { screenshot });
      taskStore.addArtifact(taskId, 'observation', humanCheck);
      const updated = taskStore.setStatus(taskId, 'needs_human', 'task.needs_human', humanCheck.evidence);
      updated.error = {
        errorCode: 'HUMAN_CHECK_REQUIRED',
        message: 'Human verification is required. Complete it in the browser, then resume the task.',
        retryable: true,
        evidence: humanCheck.evidence,
      };
      await dispatchWebhook(updated.webhookUrl, 'task.needs_human', updated).catch(() => {});
      return;
    }

    const screenshot = await screenshotPage(session.page);
    taskStore.addArtifact(taskId, 'screenshot', { screenshot });
    taskStore.addArtifact(taskId, 'log', { browserEvents: browserEventService.getEvents(session.id) });
    taskStore.addArtifact(taskId, 'result', result);
    const completed = taskStore.complete(taskId, result);
    await dispatchWebhook(completed.webhookUrl, task.type === 'web.monitor' ? 'monitor.triggered' : 'task.completed', completed).catch(() => {});
    await sessionManager.delete(session.id);
  } catch (err) {
    const failed = taskStore.fail(taskId, {
      errorCode: 'TASK_EXECUTION_FAILED',
      message: (err as Error).message,
      retryable: true,
      evidence: [task.type],
    });
    if (session) {
      taskStore.addArtifact(taskId, 'log', { browserEvents: browserEventService.getEvents(session.id) });
    }
    await dispatchWebhook(failed.webhookUrl, 'task.failed', failed).catch(() => {});
    await sessionManager.delete(session.id);
  }
}

async function executeTypedTask(task: TaskRecord, page: import('playwright-core').Page): Promise<unknown> {
  switch (task.type) {
    case 'travel.flight_search':
      return googleFlightsSearch(page, {
        origin: asString(task.input.origin),
        destination: asString(task.input.destination),
        departDate: asString(task.input.departDate),
        tripType: task.input.tripType === 'round-trip' ? 'round-trip' : 'one-way',
        returnDate: asString(task.input.returnDate) || undefined,
        passengers: asNumber(task.input.passengers),
        cabin: asString(task.input.cabin) || undefined,
        preference: asString(task.input.preference) || undefined,
      });

    case 'travel.hotel_search':
      return bookingSearchHotels(
        page,
        asString(task.input.destination),
        asRecord(task.input.dates) as { checkin?: string; checkout?: string } | undefined,
        asRecord(task.input.guests) as { adults?: number; children?: number } | undefined,
        asNumber(task.input.rooms),
        asNumber(task.input.budgetMax),
        asString(task.input.currency) || undefined,
      );

    case 'shopping.product_search':
      return flipkartSearchProduct(page, asString(task.input.query), asRecord(task.input.filters));

    case 'shopping.product_select':
      return flipkartSelectSize(page, asString(task.input.size));

    case 'web.form_fill':
      return fillFormTask(page, task.input);

    case 'web.extract':
      return extractTask(page, task.input);

    case 'web.monitor':
      return monitorTask(page, task.input);

    case 'qa.flow_test':
      return qaFlowTask(page, task.input);

    default:
      throw new Error(`Unsupported task type: ${task.type}`);
  }
}

async function fillFormTask(page: import('playwright-core').Page, input: Record<string, unknown>): Promise<unknown> {
  const url = asString(input.url);
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const fields = Array.isArray(input.fields) ? input.fields : [];
  const filled: Array<Record<string, unknown>> = [];
  for (const field of fields) {
    const item = asRecord(field);
    if (!item) continue;
    const result = await findElementWithAI(page, asString(item.description));
    await result.locator.fill(asString(item.value));
    filled.push({ description: item.description, strategy: result.strategy });
  }
  return { status: 'drafted', submitted: false, fields: filled, url: page.url() };
}

async function extractTask(page: import('playwright-core').Page, input: Record<string, unknown>): Promise<unknown> {
  const url = asString(input.url);
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const observation = await observePage(page, asNumber(input.maxElements) ?? 100);
  return {
    url: observation.url,
    title: observation.title,
    text: observation.text,
    elements: observation.elements,
    schema: asRecord(input.schema) ?? {},
  };
}

async function monitorTask(page: import('playwright-core').Page, input: Record<string, unknown>): Promise<unknown> {
  const result = await extractTask(page, input);
  return { triggered: true, result };
}

async function qaFlowTask(page: import('playwright-core').Page, input: Record<string, unknown>): Promise<unknown> {
  const url = asString(input.url);
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const observation = await observePage(page, 80);
  const results = checks.map((check) => {
    const text = typeof check === 'string' ? check : JSON.stringify(check);
    return {
      check,
      passed: observation.text.toLowerCase().includes(text.toLowerCase()),
    };
  });
  return { url: page.url(), title: await page.title(), results, consoleErrors: [], networkFailures: [] };
}

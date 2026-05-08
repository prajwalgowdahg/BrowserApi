import { randomUUID } from 'node:crypto';
import type { V1Status } from '../utils/v1Response.js';

export type TaskType =
  | 'travel.flight_search'
  | 'travel.hotel_search'
  | 'shopping.product_search'
  | 'shopping.product_select'
  | 'web.form_fill'
  | 'web.extract'
  | 'web.monitor'
  | 'qa.flow_test';

export interface TaskEvent {
  id: string;
  timestamp: string;
  action: string;
  status: V1Status;
  evidence?: string[];
  error?: string;
}

export interface TaskArtifact {
  id: string;
  timestamp: string;
  type: 'screenshot' | 'observation' | 'extracted_data' | 'result' | 'timeline' | 'log';
  data: unknown;
}

export interface TaskRecord {
  id: string;
  type: TaskType;
  input: Record<string, unknown>;
  status: V1Status;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  profileId?: string;
  sessionId?: string;
  webhookUrl?: string;
  result?: unknown;
  error?: {
    errorCode: string;
    message: string;
    retryable: boolean;
    evidence?: string[];
  };
  events: TaskEvent[];
  artifacts: TaskArtifact[];
}

export class TaskStore {
  private tasks = new Map<string, TaskRecord>();

  create(params: {
    type: TaskType;
    input: Record<string, unknown>;
    projectId?: string;
    profileId?: string;
    webhookUrl?: string;
  }): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: randomUUID(),
      type: params.type,
      input: params.input,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      projectId: params.projectId,
      profileId: params.profileId,
      webhookUrl: params.webhookUrl,
      events: [],
      artifacts: [],
    };
    this.tasks.set(task.id, task);
    this.addEvent(task.id, 'task.created', 'queued');
    return task;
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  setStatus(taskId: string, status: V1Status, action = `task.${status}`, evidence?: string[]): TaskRecord {
    const task = this.require(taskId);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    this.addEvent(taskId, action, status, evidence);
    return task;
  }

  setSession(taskId: string, sessionId: string): void {
    const task = this.require(taskId);
    task.sessionId = sessionId;
    task.updatedAt = new Date().toISOString();
  }

  complete(taskId: string, result: unknown): TaskRecord {
    const task = this.require(taskId);
    task.result = result;
    this.addArtifact(taskId, 'result', result);
    return this.setStatus(taskId, 'completed', 'task.completed');
  }

  fail(taskId: string, error: TaskRecord['error']): TaskRecord {
    const task = this.require(taskId);
    task.error = error;
    task.updatedAt = new Date().toISOString();
    this.addEvent(taskId, 'task.failed', 'failed', error?.evidence, error?.message);
    task.status = 'failed';
    return task;
  }

  addEvent(taskId: string, action: string, status: V1Status, evidence?: string[], error?: string): TaskEvent {
    const task = this.require(taskId);
    const event: TaskEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      status,
      evidence,
      error,
    };
    task.events.push(event);
    task.updatedAt = event.timestamp;
    return event;
  }

  addArtifact(taskId: string, type: TaskArtifact['type'], data: unknown): TaskArtifact {
    const task = this.require(taskId);
    const artifact: TaskArtifact = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      data,
    };
    task.artifacts.push(artifact);
    task.updatedAt = artifact.timestamp;
    return artifact;
  }

  private require(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}

export const taskStore = new TaskStore();


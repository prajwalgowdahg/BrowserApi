import type { TaskRecord } from './taskStore.js';

export type WebhookEventName =
  | 'task.completed'
  | 'task.failed'
  | 'task.needs_human'
  | 'task.needs_approval'
  | 'monitor.triggered';

export async function dispatchWebhook(
  webhookUrl: string | undefined,
  event: WebhookEventName,
  task: TaskRecord,
): Promise<void> {
  if (!webhookUrl) return;

  const payload = {
    event,
    taskId: task.id,
    type: task.type,
    status: task.status,
    projectId: task.projectId,
    result: task.result,
    error: task.error,
    updatedAt: task.updatedAt,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
    } catch {
      // retry below
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
}


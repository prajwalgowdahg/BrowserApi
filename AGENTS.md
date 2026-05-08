# Building Agents on BrowseAPI

BrowseAPI is a browser-task platform for developers who want agents that can operate web apps without relying on official APIs. The reliable pattern is:

1. Convert user intent into a typed task.
2. Run the task through `/v1` task APIs.
3. Watch task status, events, and artifacts.
4. Pause for human checks or approval gates.
5. Resume when the user has completed the manual step.

The low-level `/sessions` APIs still exist, but most product agents should start with the `/v1` task APIs.

## Core Concepts

### Task

A task is one unit of useful work, such as searching flights, finding hotels, extracting page data, filling a form draft, or running a QA flow.

```json
{
  "type": "travel.flight_search",
  "input": {
    "origin": "Bengaluru",
    "destination": "Delhi",
    "departDate": "2026-05-15",
    "tripType": "one-way",
    "preference": "cheapest good deal"
  }
}
```

### Status

Every task returns one of these statuses:

| Status | Meaning |
|--------|---------|
| `queued` | Task has been created. |
| `running` | Task is actively executing. |
| `completed` | Task finished successfully. |
| `needs_human` | CAPTCHA, OTP, or security check requires manual user action. |
| `needs_approval` | The next action is sensitive, such as payment, purchase, booking confirmation, or destructive account change. |
| `failed` | Task failed but may be retryable. |
| `cancelled` | Task was cancelled by the caller. |

### Events

Events are the chronological execution log for a task. Use them for debugging, timelines, user-visible progress, and replay UIs.

```bash
curl http://localhost:3000/v1/tasks/TASK_ID/events
```

### Artifacts

Artifacts are evidence produced while running the task:

- screenshots
- observations
- extracted data
- final result payloads
- logs

```bash
curl http://localhost:3000/v1/tasks/TASK_ID/artifacts
```

## Basic Agent Architecture

Recommended architecture:

```text
User message
  -> Intent parser / planner
  -> BrowseAPI typed task
  -> Task status loop
  -> Human approval or verification UI if needed
  -> Final answer with evidence
```

Your agent should not try to click through everything by itself. For known domains or common use cases, prefer typed tasks. Use raw browser actions only as fallback/debug tools.

## API Entry Points

### Generic Task Runner

```bash
curl -X POST http://localhost:3000/v1/tasks/run \
  -H "Content-Type: application/json" \
  -H "x-project-id: demo" \
  -d '{
    "type": "web.extract",
    "input": {
      "url": "https://example.com",
      "schema": {
        "title": "main heading"
      }
    }
  }'
```

### Usecase Routes

These are easier for product developers than the generic task route:

```text
POST /v1/travel/flights/search
POST /v1/travel/hotels/search
POST /v1/shopping/search
POST /v1/shopping/select-options
POST /v1/shopping/add-to-cart
POST /v1/extract
POST /v1/forms/fill
POST /v1/qa/run
```

## Example: Flight Search Agent

User asks:

```text
Find me a one-way flight from Bengaluru to Delhi on May 15, cheapest good deal.
```

Your planner should produce:

```json
{
  "origin": "Bengaluru",
  "destination": "Delhi",
  "departDate": "2026-05-15",
  "tripType": "one-way",
  "passengers": 1,
  "cabin": "economy",
  "preference": "cheapest good deal"
}
```

Call:

```bash
curl -X POST http://localhost:3000/v1/travel/flights/search \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "Bengaluru",
    "destination": "Delhi",
    "departDate": "2026-05-15",
    "tripType": "one-way",
    "passengers": 1,
    "cabin": "economy",
    "preference": "cheapest good deal"
  }'
```

Then inspect:

```bash
curl http://localhost:3000/v1/tasks/TASK_ID/events
curl http://localhost:3000/v1/tasks/TASK_ID/artifacts
```

## Example: Hotel Search Agent

User asks:

```text
Search best hotel under 5000 rs in Kerala Wayanad for tomorrow.
```

Planner output:

```json
{
  "destination": "Wayanad, Kerala",
  "dates": {
    "checkin": "2026-05-09",
    "checkout": "2026-05-10"
  },
  "budgetMax": 5000,
  "currency": "INR",
  "guests": {
    "adults": 2
  },
  "rooms": 1
}
```

Call:

```bash
curl -X POST http://localhost:3000/v1/travel/hotels/search \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Wayanad, Kerala",
    "dates": {
      "checkin": "2026-05-09",
      "checkout": "2026-05-10"
    },
    "budgetMax": 5000,
    "currency": "INR",
    "guests": {
      "adults": 2
    },
    "rooms": 1
  }'
```

## Example: Shopping Agent

User asks:

```text
Find black jeans size 32 on Flipkart.
```

Step 1: search products.

```bash
curl -X POST http://localhost:3000/v1/shopping/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "black jeans",
    "filters": {
      "size": "32",
      "color": "black"
    }
  }'
```

Step 2: select option if the product page is open or the task has navigated there.

```bash
curl -X POST http://localhost:3000/v1/shopping/select-options \
  -H "Content-Type: application/json" \
  -d '{
    "size": "32"
  }'
```

Step 3: adding to cart may trigger `needs_approval` depending on the task input. Payment and checkout must always remain gated.

## Example: Form Fill Agent

Use this for form drafting, not irreversible submission.

```bash
curl -X POST http://localhost:3000/v1/forms/fill \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://the-internet.herokuapp.com/login",
    "fields": [
      { "description": "username input", "value": "tomsmith" },
      { "description": "password input", "value": "SuperSecretPassword!" }
    ]
  }'
```

If your agent wants to submit a final form, place an approval gate in your product UI before resuming the task.

## Handling Human Checks

BrowseAPI does not bypass CAPTCHA, OTP, payment confirmations, booking confirmations, or account security checks.

When such a check is detected, the task returns:

```json
{
  "success": true,
  "data": {
    "status": "needs_human",
    "error": {
      "errorCode": "HUMAN_CHECK_REQUIRED",
      "message": "Human verification is required. Complete it in the browser, then resume the task.",
      "retryable": true
    }
  }
}
```

Your product should:

1. Show the user the browser or instructions.
2. Wait for the user to complete the check manually.
3. Call:

```bash
curl -X POST http://localhost:3000/v1/tasks/TASK_ID/resume
```

## Handling Approval Gates

Sensitive actions return `needs_approval`:

- payment
- purchase
- checkout
- booking confirmation
- OTP submission
- destructive account actions

Your product should show a clear confirmation UI and only resume if the user explicitly approves.

## TypeScript Client Example

```ts
type TaskStatus =
  | 'queued'
  | 'running'
  | 'needs_human'
  | 'needs_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface TaskResponse<T = unknown> {
  success: true;
  data: {
    id: string;
    status: TaskStatus;
    result?: T;
    error?: {
      errorCode: string;
      message: string;
      retryable: boolean;
      evidence?: string[];
    };
  };
  meta: {
    taskId: string;
    status: TaskStatus;
    durationMs?: number;
  };
}

async function runFlightSearch() {
  const res = await fetch('http://localhost:3000/v1/travel/flights/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-project-id': 'demo-app'
    },
    body: JSON.stringify({
      origin: 'Bengaluru',
      destination: 'Delhi',
      departDate: '2026-05-15',
      tripType: 'one-way',
      preference: 'cheapest good deal'
    })
  });

  const task = (await res.json()) as TaskResponse;

  if (task.data.status === 'needs_human') {
    // Show browser handoff UI, then call /resume.
    return task;
  }

  if (task.data.status === 'needs_approval') {
    // Show confirmation UI, then call /resume if approved.
    return task;
  }

  return task.data.result;
}
```

## Building a Planner

Your agent planner should convert messy user text into a typed task.

Good planner output:

```json
{
  "type": "travel.flight_search",
  "input": {
    "origin": "Bengaluru",
    "destination": "Delhi",
    "departDate": "2026-05-15",
    "tripType": "one-way",
    "preference": "cheapest good deal"
  }
}
```

Avoid sending raw natural language directly to browser actions unless:

- the domain has no adapter
- the action is low risk
- the user expects exploratory browsing
- you have a fallback/handoff path

## When to Use Raw Session APIs

Use `/sessions/...` or `/v1/sessions/...` for:

- debugging a failing task
- building a new adapter
- exploratory browser automation
- inspecting observations and screenshots
- custom flows not yet supported by task types

For product features, prefer `/v1/tasks` and the usecase routes.

## Webhooks

When creating a task, pass `webhookUrl`:

```json
{
  "type": "web.extract",
  "input": {
    "url": "https://example.com"
  },
  "webhookUrl": "https://your-app.com/webhooks/browseapi"
}
```

Supported event names:

- `task.completed`
- `task.failed`
- `task.needs_human`
- `task.needs_approval`
- `monitor.triggered`

## Operational Notes

- Set `API_KEYS` to require `x-api-key` on `/v1` routes.
- Use `x-project-id` to isolate logs, rate limits, and future billing.
- Tune `V1_RATE_LIMIT_PER_MINUTE` for project-level limits.
- Use headed browser mode for human handoff workflows.
- Store task IDs in your app so users can resume tasks later.

## Reliability Tips

- Prefer typed task APIs over generic browser control.
- Build adapters for high-value sites and workflows.
- Treat screenshots and observations as evidence, not the final product.
- Pause early for human checks.
- Never automate payment, OTP, or irreversible confirmation without explicit user approval.


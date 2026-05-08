# BrowseAPI

REST API for headless browser automation using natural-language element descriptions instead of CSS selectors. Describe **what** you want to interact with, and the API figures out **how**.

```
# Instead of writing CSS selectors:
await page.click('#login-form > div:nth-child(2) > input[type=submit]')

# Just describe what you want:
POST /sessions/abc123/click
{ "description": "the login button" }
```

## Quick Start

### Prerequisites

- Node.js >= 20
- A Chromium browser installed (or Playwright will use its bundled one)

### Install and Run

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Start in development mode (auto-restart on changes)
npm run dev

# Or build and run in production
npm run build
npm start
```

The server starts on **http://localhost:3000** by default.

### Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Server port |
| `NODE_ENV` | `development` | No | `development`, `production`, or `test` |
| `CHROMIUM_PATH` | auto-detect | No | Path to Chromium binary |
| `SESSION_TIMEOUT_MS` | `600000` (10 min) | No | Session inactivity timeout in ms |
| `MAX_SESSIONS` | `10` | No | Maximum concurrent sessions |
| `AZURE_OPENAI_ENDPOINT` | — | For AI finding | Azure OpenAI resource endpoint URL |
| `AZURE_OPENAI_API_KEY` | — | For AI finding | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | — | For AI finding | GPT-4o deployment name |
| `AZURE_OPENAI_API_VERSION` | `2024-07-01-preview` | No | Azure OpenAI API version |

> **AI Element Finding** (Layers 2 & 3) requires Azure OpenAI credentials. Without them, only the heuristic layer (Layer 1) works — which handles common cases like "email input", "password field", "submit button".

### Verify It's Running

```bash
curl http://localhost:3000/health
```

```json
{ "success": true, "data": { "status": "ok" } }
```

## How Element Finding Works

The API uses a 3-layer cascade to find elements. Each layer is tried in order — the first successful match wins.

| Layer | Method | Speed | Cost | Best For |
|-------|--------|-------|------|----------|
| **1. Heuristics** | Keyword-to-selector mapping | Instant | Free | Common elements (login, email, password, submit, etc.) |
| **2. Accessibility Tree + AI** | Page ARIA snapshot → GPT-4o | Fast (~2s) | Low | Semantic elements with ARIA labels, roles, text |
| **3. Screenshot + AI Vision** | Page screenshot → GPT-4o Vision | Slower (~5s) | Higher | Visual elements, custom UI, complex layouts |

When all layers fail, the API returns an error with a **screenshot of the current page** for debugging.

## API Reference

All endpoints return JSON with this structure:

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": "Error message" }
```

Screenshots are returned as **base64-encoded PNG** thumbnails (400px wide) unless noted otherwise.

---

### Session Management

#### Create a Session

```bash
curl -X POST http://localhost:3000/sessions
```

```json
{
  "success": true,
  "data": { "sessionId": "a1b2c3d4" }
}
```

#### Delete a Session

```bash
curl -X DELETE http://localhost:3000/sessions/a1b2c3d4
```

```json
{ "success": true, "data": { "deleted": true } }
```

#### Get Session Logs

```bash
curl http://localhost:3000/sessions/a1b2c3d4/logs
```

```json
{
  "success": true,
  "data": {
    "logs": [
      { "timestamp": "2026-05-07T10:00:00.000Z", "action": "session.create", "status": "success" },
      { "timestamp": "2026-05-07T10:00:05.000Z", "action": "navigate", "status": "success", "durationMs": 1234 },
      { "timestamp": "2026-05-07T10:00:08.000Z", "action": "click", "status": "fail", "error": "Element not found", "durationMs": 0 }
    ]
  }
}
```

#### Get Current Screenshot

```bash
curl http://localhost:3000/sessions/a1b2c3d4/screenshot
```

Returns a screenshot without performing any action. Useful for debugging.

---

### Core Actions

#### Navigate

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

```json
{ "success": true, "data": { "screenshot": "<base64>", "url": "https://example.com" } }
```

#### Click

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/click \
  -H "Content-Type: application/json" \
  -d '{"description": "the login button"}'
```

```json
{ "success": true, "data": { "screenshot": "<base64>", "strategy": "heuristic" } }
```

#### Type

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/type \
  -H "Content-Type: application/json" \
  -d '{"description": "the email input", "value": "user@example.com"}'
```

```json
{ "success": true, "data": { "screenshot": "<base64>", "strategy": "heuristic" } }
```

#### Select Dropdown Option

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/select \
  -H "Content-Type: application/json" \
  -d '{"description": "the country dropdown", "value": "United States"}'
```

#### Full Page Screenshot

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/screenshot/full
```

Returns a **full-page** base64 PNG (not a thumbnail).

#### Extract Text

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/get_text \
  -H "Content-Type: application/json" \
  -d '{"description": "the page title"}'
```

```json
{ "success": true, "data": { "text": "Welcome to Example", "screenshot": "<base64>", "strategy": "heuristic" } }
```

#### Wait

```bash
# Wait for an element to appear
curl -X POST http://localhost:3000/sessions/a1b2c3d4/wait \
  -H "Content-Type: application/json" \
  -d '{"description": "the results table", "waitType": "element", "timeout": 10000}'

# Wait for navigation to complete
curl -X POST http://localhost:3000/sessions/a1b2c3d4/wait \
  -H "Content-Type: application/json" \
  -d '{"waitType": "networkidle"}'
```

| `waitType` | Description | Requires `description` |
|------------|-------------|----------------------|
| `element` | Wait for described element to be visible | Yes |
| `navigation` | Wait for any URL change | No |
| `networkidle` | Wait until no network requests | No |

#### Scroll

```bash
# Scroll down 500 pixels (default)
curl -X POST http://localhost:3000/sessions/a1b2c3d4/scroll

# Scroll down 50% of page
curl -X POST http://localhost:3000/sessions/a1b2c3d4/scroll \
  -H "Content-Type: application/json" \
  -d '{"direction": "down", "amount": 50, "unit": "percentage"}'
```

---

### Compound Actions

Single requests that orchestrate multiple steps.

#### Login Flow

Performs: navigate → fill username → fill password → click submit → wait for page load.

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/login \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/login",
    "username": "user@example.com",
    "password": "mypassword",
    "usernameDescription": "the email input",
    "passwordDescription": "the password input",
    "submitDescription": "the sign in button"
  }'
```

The `*Description` fields are optional — defaults are `"the email or username input"`, `"the password input"`, and `"the login or submit button"`.

```json
{
  "success": true,
  "data": {
    "screenshot": "<base64>",
    "url": "https://example.com/dashboard",
    "steps": [
      { "step": "navigate", "status": "completed" },
      { "step": "type_username", "status": "completed", "strategy": "heuristic" },
      { "step": "type_password", "status": "completed", "strategy": "heuristic" },
      { "step": "click_submit", "status": "completed", "strategy": "heuristic" }
    ]
  }
}
```

#### Fill Form

Fill multiple fields in one request.

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/fill_form \
  -H "Content-Type: application/json" \
  -d '{
    "fields": [
      { "description": "the first name input", "value": "John" },
      { "description": "the last name input", "value": "Doe" },
      { "description": "the email input", "value": "john@example.com" }
    ]
  }'
```

#### Scrape Structured Data

Extract data by describing what to read.

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "schema": {
      "title": "the product name",
      "price": "the price",
      "description": "the product description"
    }
  }'
```

```json
{
  "success": true,
  "data": {
    "data": {
      "title": "Widget Pro",
      "price": "$29.99",
      "description": "The best widget you'll ever own."
    },
    "screenshot": "<base64>",
    "fields": [
      { "field": "title", "strategy": "heuristic" },
      { "field": "price", "strategy": "heuristic" },
      { "field": "description", "strategy": "heuristic" }
    ]
  }
}
```

#### Submit Form

Click the submit button and wait for the result.

```bash
curl -X POST http://localhost:3000/sessions/a1b2c3d4/submit_form \
  -H "Content-Type: application/json" \
  -d '{"description": "the place order button"}'
```

```json
{
  "success": true,
  "data": {
    "screenshot": "<base64>",
    "url": "https://example.com/order-confirmation",
    "strategy": "heuristic"
  }
}
```

---

## Complete Example: Login and Scrape

```bash
# 1. Create a session
SESSION=$(curl -s -X POST http://localhost:3000/sessions | jq -r '.data.sessionId')
echo "Session: $SESSION"

# 2. Log into a site
curl -s -X POST "http://localhost:3000/sessions/$SESSION/login" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/login",
    "username": "me@example.com",
    "password": "secret"
  }' | jq '.'

# 3. Navigate to a protected page
curl -s -X POST "http://localhost:3000/sessions/$SESSION/navigate" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/dashboard"}' | jq '.'

# 4. Scrape data from the page
curl -s -X POST "http://localhost:3000/sessions/$SESSION/scrape" \
  -H "Content-Type: application/json" \
  -d '{
    "schema": {
      "balance": "the account balance",
      "lastLogin": "the last login date"
    }
  }' | jq '.data.data'

# 5. Review the action log
curl -s "http://localhost:3000/sessions/$SESSION/logs" | jq '.data.logs'

# 6. Clean up
curl -s -X DELETE "http://localhost:3000/sessions/$SESSION"
```

## Error Handling

Errors always return JSON with an `error` field. When element finding fails, the response includes a `screenshot` for debugging.

```json
{
  "success": false,
  "error": "Element not found: \"the magic button\"",
  "screenshot": "<base64 PNG of current page>"
}
```

Common error codes:

| Status | Meaning |
|--------|---------|
| `400` | Missing or invalid request fields |
| `404` | Session not found (expired or never created) |
| `429` | Maximum concurrent sessions reached |
| `500` | Unexpected error (element not found, navigation timeout, etc.) |

## v1 Platform API

BrowseAPI also exposes a higher-level `/v1` API for developers building products on top of web automation. The v1 API wraps browser sessions in typed tasks with task status, events, artifacts, policy gates, and adapter-backed flows.

Core task routes:

```bash
POST /v1/tasks/run
GET  /v1/tasks/:taskId
POST /v1/tasks/:taskId/resume
POST /v1/tasks/:taskId/cancel
GET  /v1/tasks/:taskId/events
GET  /v1/tasks/:taskId/artifacts
GET  /v1/openapi.json
```

Usecase routes:

```bash
POST /v1/travel/flights/search
POST /v1/travel/hotels/search
POST /v1/shopping/search
POST /v1/shopping/select-options
POST /v1/shopping/add-to-cart
POST /v1/extract
POST /v1/forms/fill
POST /v1/qa/run
```

Example:

```bash
curl -X POST http://localhost:3000/v1/tasks/run \
  -H "Content-Type: application/json" \
  -H "x-project-id: demo" \
  -d '{
    "type": "travel.flight_search",
    "input": {
      "origin": "Bengaluru",
      "destination": "Delhi",
      "departDate": "2026-05-15",
      "tripType": "one-way",
      "preference": "cheapest good deal"
    }
  }'
```

The response uses a stable envelope:

```json
{
  "success": true,
  "data": { "id": "task-id", "status": "completed" },
  "meta": { "taskId": "task-id", "status": "completed", "durationMs": 1234 }
}
```

Human checks, OTPs, payment, purchase, booking confirmation, and destructive actions are returned as resumable states such as `needs_human` or `needs_approval`; the API does not bypass them.

More examples are in `examples/v1-platform-examples.md`.

For a full developer guide on building agents on top of BrowseAPI, see `AGENTS.md`.

## Session Behavior

- Sessions are **in-memory only** — no persistence across server restarts
- Each session has an **isolated browser context** (cookies, storage, state survive between requests)
- Sessions **auto-expire** after 10 minutes of inactivity
- Maximum **10 concurrent sessions** (configurable via `MAX_SESSIONS`)
- Always `DELETE` sessions when done to free resources

## Running Tests

```bash
# Run full test suite
npm test

# Run in watch mode
npm run test:watch
```

## Tech Stack

- **Express 5** — HTTP server with native async error handling
- **Playwright** — Chromium browser automation
- **Azure OpenAI GPT-4o** — AI-powered element finding (accessibility tree + vision)
- **Zod** — Request validation
- **Sharp** — Screenshot thumbnail generation
- **Vitest** — Testing

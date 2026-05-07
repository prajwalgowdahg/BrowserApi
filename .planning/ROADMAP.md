# Roadmap: BrowseAPI

## Overview

Build a REST API that lets callers control a headless Chromium browser using natural-language element descriptions instead of CSS selectors. The journey starts with server infrastructure and session management, proves the action pipeline with cheap heuristic element finding, then layers on the core AI-powered element finder (the differentiator), adds compound actions that compose atomic operations, and finishes with observability and error polish.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Express server, config validation, browser manager, error infrastructure, response contract
- [x] **Phase 2: Session Management** - Create/destroy sessions, TTL auto-expiry, concurrency limits, isolated browser contexts, live screenshot endpoint (completed 2026-05-04)
- [ ] **Phase 3: Core Actions with Heuristic Finding** - Navigate, click, type, select, screenshot, get_text, wait_for, scroll with Layer 1 heuristic element finder
- [ ] **Phase 4: AI-Powered Element Finding** - 3-layer element finder with accessibility tree analysis and GPT-4o vision fallback
- [ ] **Phase 5: Compound Actions** - Login, fill_form, scrape, and submit_form in single requests (completed 2026-05-05)
- [ ] **Phase 6: Observability and Error Polish** - Consistent error responses with screenshots, action logging with session correlation

## Phase Details

### Phase 1: Foundation
**Goal**: A running Express server that can launch Chromium, validate configuration, and never crashes on errors
**Depends on**: Nothing (first phase)
**Requirements**: ERR-01, ERR-03, ERR-04
**Success Criteria** (what must be TRUE):
  1. Server starts and responds to a health check endpoint with `{ success: true, data: { status: "ok" } }`
  2. Server fails fast with a clear error message if Azure OpenAI credentials or required config are missing
  3. A request to a nonexistent route returns `{ success: false, error: "..." }` instead of HTML or a crash
  4. An unhandled error in an async route handler returns a JSON error response, not a hung request or server crash
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md -- Project scaffolding, Express 5 app with error handling, health check, and integration tests

### Phase 2: Session Management
**Goal**: Callers can create isolated browser sessions that persist state, auto-expire when idle, and are bounded by concurrency limits
**Depends on**: Phase 1
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, DBG-01
**Success Criteria** (what must be TRUE):
  1. Caller can POST to create a session and receive a sessionId; subsequent requests using that sessionId hit the same browser context
  2. Caller can DELETE a session, and its browser context is closed and resources freed
  3. A session that receives no requests for 10 minutes is automatically cleaned up and returns an error if used again
  4. When 10 sessions already exist, an 11th creation request is rejected with a clear error
  5. Caller can GET a screenshot of the current page state without performing any action
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Session engine: BrowserManager singleton, SessionManager class with lifecycle/timers/capacity, thumbnail utility, unit tests
- [ ] 02-02-PLAN.md -- API wiring: session CRUD routes, screenshot route, app.ts/server.ts updates, integration tests with real Chromium

### Phase 3: Core Actions with Heuristic Finding
**Goal**: Callers can perform all 8 core browser actions using plain-English element descriptions resolved by heuristic selectors
**Depends on**: Phase 2
**Requirements**: NAV-01, NAV-02, ACT-01, ACT-02, ACT-03, ACT-04, ACT-05, ACT-06, ACT-07, ACT-08, FIND-01
**Success Criteria** (what must be TRUE):
  1. Caller can navigate to a URL and receives a thumbnail screenshot (400px) confirming the page loaded to networkidle
  2. Caller can click a button or link by describing it (e.g., "the login button") and the action completes with a verification screenshot
  3. Caller can type text into a field by describing it (e.g., "the email input") and the value appears in the field
  4. Caller can take a full-page screenshot and receive it as base64
  5. Caller can extract text content from a described element, select a dropdown option, scroll the page, and wait for a described element or page state
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md -- Heuristic element finder service with keyword-to-locator mapping and unit tests (FIND-01)
- [ ] 03-02-PLAN.md -- Action route handlers (navigate, click, type, select, screenshot/full, get_text, wait, scroll) with integration tests (NAV-01/02, ACT-01..08)

### Phase 4: AI-Powered Element Finding
**Goal**: The element finder resolves any described element through a 3-layer cascade, using AI when heuristics fail
**Depends on**: Phase 3
**Requirements**: FIND-02, FIND-03, FIND-04, FIND-05
**Success Criteria** (what must be TRUE):
  1. When heuristics fail, the finder sends an accessibility tree snapshot to GPT-4o and gets back a selector that successfully identifies the described element
  2. When the a11y tree layer fails, the finder sends a screenshot to GPT-4o vision and gets back coordinates that click the correct element
  3. The finder cascades 1 -> 2 -> 3 automatically, returning the first successful match without redundant AI calls
  4. When all 3 layers fail, the response includes a screenshot of the current page for debugging
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- AI client singleton, Layer 2 (a11y tree + GPT-4o), Layer 3 (screenshot + GPT-4o Vision), prompt templates, unit tests (FIND-02, FIND-03)
- [ ] 04-02-PLAN.md -- 3-layer cascade controller, ElementNotFoundError with diagnostics, route wiring to use cascade finder, integration tests (FIND-04, FIND-05)

### Phase 5: Compound Actions
**Goal**: Callers can perform multi-step flows (login, fill forms, scrape data, submit) in a single API request
**Depends on**: Phase 4
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04
**Success Criteria** (what must be TRUE):
  1. Caller can perform a complete login flow in one request by providing URL, username, password, and element descriptions; the response confirms successful login
  2. Caller can fill a form in one request by providing an array of {description, value} pairs; all fields are populated
  3. Caller can scrape structured data by providing field-to-description mappings and receives a JSON object with extracted values
  4. Caller can submit the current form and receives confirmation with a screenshot of the result
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md -- Compounds router with login (COMP-01) and fill_form (COMP-02) endpoints, app.ts registration, integration tests
- [x] 05-02-PLAN.md -- Scrape (COMP-03) and submit_form (COMP-04) endpoints, integration tests

### Phase 6: Observability and Error Polish
**Goal**: Every action produces structured logs, every error includes a diagnostic screenshot, and the API surface is consistent and debuggable
**Depends on**: Phase 5
**Requirements**: ERR-02, LOG-01
**Success Criteria** (what must be TRUE):
  1. When an element is not found, the error response includes a screenshot of the current page state
  2. Every action (across all endpoints) is logged with timestamp, sessionId, action name, and success/fail status
  3. A caller can review logs for a session to trace the full sequence of actions and their outcomes
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md -- ERR-02 screenshot enrichment in error handler, ActionLogService with in-memory per-session storage, session cleanup integration
- [ ] 06-02-PLAN.md -- Wire logging into all route handlers, GET /sessions/:sessionId/logs endpoint, integration tests

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 1/1 | Complete | 2026-05-04 |
| 2. Session Management | 2/2 | Complete   | 2026-05-04 |
| 3. Core Actions | 2/2 | Complete | 2026-05-04 |
| 4. AI Element Finding | 2/2 | Complete | 2026-05-04 |
| 5. Compound Actions | 2/2 | Complete | 2026-05-05 |
| 6. Observability and Polish | 0/2 | Not started | - |

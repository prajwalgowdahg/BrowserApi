# Requirements: BrowseAPI

**Defined:** 2026-05-02
**Core Value:** Callers never write a CSS selector or XPath — they describe WHAT they want to do, and the API handles HOW.

## v1 Requirements

### Session Management

- [x] **SESS-01**: Caller can create a new browser session and receive a unique sessionId
- [x] **SESS-02**: Caller can delete a session, closing its browser context and freeing resources
- [x] **SESS-03**: Sessions automatically expire after 10 minutes of inactivity and clean up their browser context
- [x] **SESS-04**: Server enforces a maximum of 10 concurrent sessions, rejecting new sessions at capacity
- [x] **SESS-05**: Each session maintains an isolated, persistent browser context (cookies, storage, state survive between requests)

### Navigation

- [x] **NAV-01**: Caller can navigate to a URL and the server waits for networkidle before responding
- [x] **NAV-02**: Navigation returns a thumbnail screenshot (400px wide) so caller can verify page state

### Element Finding

- [x] **FIND-01**: Element finder uses heuristic selector mapping as Layer 1 (free, instant) — maps keywords like "email", "password", "submit" to common CSS selectors
- [x] **FIND-02**: Element finder uses accessibility tree snapshot + Azure OpenAI as Layer 2 (fast, cheap) — sends ARIA snapshot to GPT-4o, gets back a selector with confidence score
- [x] **FIND-03**: Element finder uses full-page screenshot + Azure OpenAI Vision as Layer 3 (accurate, fallback) — sends screenshot to GPT-4o vision, gets back coordinates and optional selector
- [x] **FIND-04**: Element finder cascades through layers 1→2→3, returning the first successful match
- [x] **FIND-05**: If all 3 layers fail, the API returns an error with a screenshot for debugging

### Core Actions

- [x] **ACT-01**: Caller can click an element by describing it in plain English (e.g., "the login button")
- [x] **ACT-02**: Caller can type text into a field by describing it (e.g., "the email input")
- [x] **ACT-03**: Caller can select a dropdown option by describing the dropdown and providing a value
- [x] **ACT-04**: Caller can take a full-page screenshot and receive it as base64
- [x] **ACT-05**: Caller can extract text content from an element by describing it
- [x] **ACT-06**: Caller can wait for a described element, navigation, or network idle state
- [x] **ACT-07**: Caller can scroll the page by direction (up/down) and amount (pixels or percentage)
- [x] **ACT-08**: Every action returns a thumbnail screenshot (400px wide) for verification

### Compound Actions

- [ ] **COMP-01**: Caller can perform a login flow in a single request (navigate to URL, type username, type password, click submit)
- [ ] **COMP-02**: Caller can fill a form in a single request by providing an array of {description, value} field pairs
- [ ] **COMP-03**: Caller can scrape structured data by providing a schema mapping field names to element descriptions
- [ ] **COMP-04**: Caller can submit the current form by clicking the submit button

### Error Handling & Logging

- [x] **ERR-01**: All endpoints return a consistent JSON response: { success: boolean, data?, error?, screenshot? }
- [ ] **ERR-02**: On element-not-found, response includes a screenshot of the current page state
- [x] **ERR-03**: Server never crashes — all route handlers wrapped in try/catch
- [x] **ERR-04**: Express async error handling prevents silent swallowed errors in async route handlers
- [ ] **LOG-01**: Every action is logged with timestamp, sessionId, action name, and success/fail

### Live Debugging

- [x] **DBG-01**: Caller can get a current screenshot via GET /session/:sessionId/screenshot without performing an action

## v2 Requirements

### Enhanced Features

- **FIND-06**: Smart error recovery with page state diagnostics and suggestions when element finding fails
- **SESS-06**: API key authentication middleware for non-internal use
- **ACT-09**: Anti-detection / stealth mode for targeting third-party sites
- **COMP-05**: WebSocket streaming for long-running compound action progress

## Out of Scope

| Feature | Reason |
|---------|--------|
| CAPTCHA solving | Arms race, unreliable, ethically questionable — return CAPTCHA state to caller instead |
| Proxy rotation | Requires massive infrastructure, different product category — support single proxy config per session instead |
| Multi-server session persistence | Violates in-memory constraint, adds distributed system complexity |
| Recording/playback of action sequences | Full product category (Skyvern), caller can build on top of the API |
| Mobile browser emulation | Explicitly scoped out — Chromium desktop only |
| Workflow orchestration / DAG execution | Turns API into a workflow engine — caller holds orchestration logic |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ERR-01 | Phase 1 | Complete |
| ERR-03 | Phase 1 | Complete |
| ERR-04 | Phase 1 | Complete |
| SESS-01 | Phase 2 | Complete |
| SESS-02 | Phase 2 | Complete |
| SESS-03 | Phase 2 | Complete |
| SESS-04 | Phase 2 | Complete |
| SESS-05 | Phase 2 | Complete |
| DBG-01 | Phase 2 | Complete |
| NAV-01 | Phase 3 | Complete |
| NAV-02 | Phase 3 | Complete |
| FIND-01 | Phase 3 | Complete |
| ACT-01 | Phase 3 | Complete |
| ACT-02 | Phase 3 | Complete |
| ACT-03 | Phase 3 | Complete |
| ACT-04 | Phase 3 | Complete |
| ACT-05 | Phase 3 | Complete |
| ACT-06 | Phase 3 | Complete |
| ACT-07 | Phase 3 | Complete |
| ACT-08 | Phase 3 | Complete |
| FIND-02 | Phase 4 | Complete |
| FIND-03 | Phase 4 | Complete |
| FIND-04 | Phase 4 | Complete |
| FIND-05 | Phase 4 | Complete |
| COMP-01 | Phase 5 | Pending |
| COMP-02 | Phase 5 | Pending |
| COMP-03 | Phase 5 | Pending |
| COMP-04 | Phase 5 | Pending |
| ERR-02 | Phase 6 | Pending |
| LOG-01 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

---
*Requirements defined: 2026-05-02*
*Last updated: 2026-05-02 after roadmap creation*

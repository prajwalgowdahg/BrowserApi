# BrowseAPI

## What This Is

A REST API server that lets callers describe browser actions in plain English (e.g., "click the login button") and the server figures out how to execute them using a 3-layer cascade (heuristics → accessibility tree + GPT-4o → screenshot + GPT-4o Vision). Built with Node.js + Express 5 + Playwright, each session maintains a persistent Chromium browser context that stays open between requests. Includes compound actions (login, fill form, scrape, submit), structured action logging, and diagnostic screenshots on errors.

## Core Value

Callers never write a CSS selector or XPath — they describe WHAT they want to do, and the API handles HOW.

## Requirements

### Validated

- ✓ REST API server with session-based browser automation — v1.0
- ✓ Smart element finder with 3-layer fallback (heuristics → a11y tree + AI → screenshot + AI vision) — v1.0
- ✓ Session management with persistent browser contexts, timeout, and concurrency limits — v1.0
- ✓ Core actions: navigate, click, type, select, screenshot, get_text, wait_for, scroll — v1.0
- ✓ Compound actions: login, fill_form, scrape, submit_form — v1.0
- ✓ Azure OpenAI (GPT-4o) integration for vision-based element finding — v1.0
- ✓ Error handling with screenshots on failure, never crash the server — v1.0
- ✓ Logging of all actions with timestamp, sessionId, action, success/fail — v1.0

### Active

- [ ] README with curl examples for every endpoint

### Out of Scope

- Authentication/authorization on the API itself — internal tool, no auth needed initially
- Multi-server/session persistence (sessions are in-memory only)
- Mobile browser emulation — Chromium desktop only
- Recording/playback of action sequences
- CAPTCHA solving, proxy rotation, workflow orchestration

## Context

- Shipped v1.0 with 4,065 LOC TypeScript across 54 files, 134 tests passing
- Tech stack: Express 5.2.1, Playwright 1.59.1, Azure OpenAI GPT-4o, Zod 4.4.2, Vitest 4.1.5
- 15 API endpoints: health, 3 session endpoints, 8 core actions, 4 compound actions
- 3-layer cascade element finder is the differentiator — handles any described element
- Sessions auto-expire after 10 minutes of inactivity, max 10 concurrent sessions
- Action logging provides full session traceability via GET /sessions/:sessionId/logs

## Constraints

- **Tech stack**: Node.js + Express + Playwright (Chromium) + Azure OpenAI API — user specified
- **AI Service**: Azure OpenAI (GPT-4o vision) for element finding, not Anthropic Claude
- **Session storage**: In-memory Map only — no external session store
- **Concurrent sessions**: Maximum 10 at any time
- **Session timeout**: 10 minutes of inactivity, auto-cleanup

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Azure OpenAI over Anthropic Claude | User specified Azure ChatGPT API | ✓ Good — GPT-4o vision handles element finding well |
| 3-layer element finder | Balances cost (free heuristics first) with accuracy (vision fallback last) | ✓ Good — cascade pattern works cleanly, transparent to callers |
| In-memory session store | Simple, sufficient for single-server internal tool | ✓ Good — Map-based, no external dependencies |
| Playwright over Puppeteer | Better a11y tree support, auto-wait capabilities | ✓ Good — accessibility tree feeds Layer 2 AI finder |
| Express 5 | Async error handling built in, no wrapper needed | ✓ Good — no swallowed errors |
| Zod v4 for validation | Array-of-object and record schemas for compound actions | ✓ Good — inline validation matches existing patterns |
| In-memory action logging | No external logging library needed for single-server | ✓ Good — per-session Map with GET endpoint |
| Vision coordinate click handling | Vision layer returns coordinates, not selectors | ✓ Good — bifurcated click (locator vs mouse.click) works |

---
*Last updated: 2026-05-07 after v1.0 milestone*

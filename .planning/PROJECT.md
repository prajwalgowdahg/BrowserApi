# BrowseAPI

## What This Is

A REST API server that lets callers describe browser actions in plain English (e.g., "click the login button") and the server figures out how to execute them using Playwright and Azure OpenAI GPT-4o vision. Built with Node.js + Express, each session maintains a persistent Chromium browser context that stays open between requests.

## Core Value

Callers never write a CSS selector or XPath — they describe WHAT they want to do, and the API handles HOW.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] REST API server with session-based browser automation
- [ ] Smart element finder with 3-layer fallback (heuristics → a11y tree + AI → screenshot + AI vision)
- [ ] Session management with persistent browser contexts, timeout, and concurrency limits
- [ ] Core actions: navigate, click, type, select, screenshot, get_text, wait_for, scroll
- [ ] Compound actions: login, fill_form, scrape, submit_form
- [ ] Azure OpenAI (GPT-4o) integration for vision-based element finding
- [ ] Error handling with screenshots on failure, never crash the server
- [ ] Logging of all actions with timestamp, sessionId, action, success/fail
- [ ] README with curl examples for every endpoint

### Out of Scope

- Authentication/authorization on the API itself — internal tool, no auth needed initially
- Multi-server/session persistence (sessions are in-memory only)
- Mobile browser emulation — Chromium desktop only
- Recording/playback of action sequences

## Context

- Built for developers/automation engineers who want high-level browser control without dealing with selectors
- Uses Azure OpenAI GPT-4o for the vision and accessibility-tree analysis layers of element finding
- Playwright's Chromium browser handles all actual page interaction
- Each session is an isolated browser context — cookies, storage, and state persist between requests within a session
- Sessions auto-expire after 10 minutes of inactivity, max 10 concurrent sessions

## Constraints

- **Tech stack**: Node.js + Express + Playwright (Chromium) + Azure OpenAI API — user specified
- **AI Service**: Azure OpenAI (GPT-4o vision) for element finding, not Anthropic Claude
- **Session storage**: In-memory Map only — no external session store
- **Concurrent sessions**: Maximum 10 at any time
- **Session timeout**: 10 minutes of inactivity, auto-cleanup

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Azure OpenAI over Anthropic Claude | User specified Azure ChatGPT API | — Pending |
| 3-layer element finder | Balances cost (free heuristics first) with accuracy (vision fallback last) | — Pending |
| In-memory session store | Simple, sufficient for single-server internal tool | — Pending |
| Playwright over Puppeteer | Better a11y tree support, auto-wait capabilities | — Pending |

---
*Last updated: 2026-05-02 after initialization*

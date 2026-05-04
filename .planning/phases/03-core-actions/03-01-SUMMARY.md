---
phase: 03-core-actions
plan: 01
subsystem: api
tags: [playwright-core, heuristic, element-finding, locator, keyword-matching]

# Dependency graph
requires:
  - phase: 02-session-management
    provides: SessionData.page (Playwright Page objects used by findElement)
provides:
  - findElement(page, description) -> FindResult (heuristic element locator service)
  - FindResult interface ({ locator: Locator, strategy: string })
  - Cascading selector strategy: role keywords -> input type cascade -> text match -> role-with-name
affects: [03-core-actions, action-routes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Heuristic keyword-to-locator mapping with cascading fallback strategies"
    - "Locator.first() always returned to prevent Playwright strict mode violations"
    - "Strategy string returned alongside locator for observability/debugging"

key-files:
  created:
    - src/services/elementFinder.ts
    - tests/elementFinder.test.ts
  modified: []

key-decisions:
  - "Cascading strategy order: role keywords > input type (label/placeholder/css) > generic text > role-with-name"
  - "ROLE_KEYWORDS uses compound phrases (login button, sign in button) for disambiguation"
  - "INPUT_TYPE_KEYWORDS maps to HTML input types for CSS fallback (e.g. email -> input[type=email])"
  - "Strategy strings use colon-separated format: role:login button, label:email, text:description"

patterns-established:
  - "Element finding via heuristic cascade: free, instant, no AI required for common descriptions"
  - "FindResult { locator, strategy } as the universal element resolution contract"

requirements-completed: [FIND-01]

# Metrics
duration: 3min
completed: 2026-05-04
---

# Phase 3 Plan 1: Heuristic Element Finder Summary

**Cascading heuristic element finder that maps plain-English descriptions to Playwright Locators via role keywords, input type cascades, and text fallbacks -- no AI required**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-04T13:59:09Z
- **Completed:** 2026-05-04T14:02:15Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Created heuristic element finder with 4-level cascading strategy (role keywords, input type cascade, text match, role-with-name)
- findElement() resolves 6+ description patterns to correct Playwright locators without AI
- Every returned locator uses .first() to prevent strict mode violations
- Unresolvable descriptions throw descriptive errors with the original description text
- Full test coverage with 20 unit tests covering all strategies, cascading fallbacks, and error cases

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for heuristic element finder** - `cf94459` (test)
2. **Task 1 (GREEN): Implement heuristic element finder** - `94fdbaa` (feat)

_Note: TDD task produced 2 commits (RED + GREEN). No refactor needed._

## Files Created/Modified
- `src/services/elementFinder.ts` - Heuristic element finder with findElement() and FindResult interface
- `tests/elementFinder.test.ts` - 20 unit tests covering all cascading strategies and edge cases

## Decisions Made
- Cascading strategy order prioritizes most-specific matches first: role compound phrases > input type keywords > generic text > role-with-name
- ROLE_KEYWORDS uses compound phrases ("login button", "sign in button") to disambiguate from input types
- Strategy string format uses colon-separated identifiers (e.g., "role:login button", "label:email") for observability

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- findElement() is ready for use by action routes in Plan 02 (click, type, select, get_text, wait_for)
- FindResult interface exported for type-safe integration with route handlers
- Heuristic layer handles common descriptions; AI-based finding (Phase 4) will handle complex/ambiguous cases as a deeper fallback

## Self-Check: PASSED

- FOUND: src/services/elementFinder.ts
- FOUND: tests/elementFinder.test.ts
- FOUND: cf94459 (RED commit)
- FOUND: 94fdbaa (GREEN commit)

---
*Phase: 03-core-actions*
*Completed: 2026-05-04*

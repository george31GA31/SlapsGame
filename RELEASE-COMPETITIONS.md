# Separate League and Tournament release

## Changes

- `league.html` / `league.js`: 2–20 players, double round robin (380 fixtures for 20 players), reversed player slots for return fixtures, matchday groups, filters, standings and remaining/next-match summary. Existing scoring and shared-rank tiebreaks remain unchanged.
- `tournament.html` / `tournament.js`: 2–64 entrants, power-of-two seeded brackets with explicit advancement edges. First-round byes go to the highest Elo seeds; tied Elo uses join time then UID. Missing Elo defaults to 1000. Ratings are captured on join/ready and frozen at start.
- Shared transport remains casual RTDB transactions and existing peer gameplay. This is NOT a neutral-server ranked tournament or a claim of cheat-proof Elo. Existing casual trust boundaries are unchanged.
- Old `competitions.html` links redirect while preserving room codes. Wrong-mode room joins redirect to the appropriate dedicated page. Existing active fixtures are never regenerated; legacy eight-player brackets still progress.
- Non-gameplay pages use the sharper `arena-pages.css` component system: square panels, strong headers, separated creation/join areas, explicit readable button foregrounds, accessible disabled colors, and responsive layouts. Homepage styling and gameplay engines are unchanged.

## Required before production

1. Back up the live Firebase data and rules. Review and publish the complete updated `database.rules.free-plan.json` in Realtime Database Rules. It permits 64 tournament members, 380 league fixtures and Elo/seed metadata. GitHub commits do not publish Firebase rules. No billing upgrade or Functions deployment is needed.
2. Complete visual verification on desktop, tablet and mobile before merging this draft. The provided browser could not access the local preview (`ERR_BLOCKED_BY_CLIENT`); no visual verification is claimed. `node tests/preview-server.cjs` provides isolated mocks; `/__audit?w=390&start=0` displays six non-gameplay pages at a time (increment start by six; repeat at 768 and 1440).
3. Re-run Firebase emulator integration checks with the updated rules; the emulator dependencies are not installed in this workspace. Unit tests do not validate live database rules.
4. Test real separate signed-in devices: create/join, ready, start, full result agreement, next-round advancement, host departure and reconnect. Clients in a running room should use the same release. Reloading a live match still does not reconstruct the game engine.

## Verification performed

`npm test`: 61 passing tests, including every entrant count 2–64 through one champion, highest-seed byes, opposite-half leading seeds, all 2–20 double round-robin schedules, 380 fixtures, unique IDs, reversed slots, result idempotency, disputes, legacy fixture preservation and existing gameplay/account tests.

No live Firebase data was read or changed. Private player exports and converted outputs are deliberately outside this repository.

# SlapsGame verification

The site remains a static HTML/CSS/JavaScript application. No production build or new runtime dependency is required.

## Automated checks

Run `node --test tests/guest-mode.test.cjs` (or `npm test`).

Nine passing tests cover:

- Guest/member, member/guest and guest/guest matches: zero account writes for results, concessions, disconnects and rematches.
- Registered matches: ELO, wins and extended statistics still update exactly once.
- Missing and legacy peer identities: unranked by default.
- Account changes mid-match: no writes to the replacement account.
- Guest entry: existing authentication is signed out and a guest identity is created.
- All HTML inline scripts and root JavaScript parse, including duplicate top-level declarations across inline scripts.
- Persisted authentication is restored before a multiplayer identity is sent.

## Isolated visual preview

Run `npm run dev -- --port 4173`. This is a **test-only** preview: `tests/preview-server.cjs` substitutes fixture authentication, database and peer services in HTTP responses. It never changes the production HTML files. Do not use this test server as production hosting.

The test leaderboard contains 80 synthetic players. `/__mobile?page=leaderboard.html` renders the page inside a 390-pixel viewport. The default mobile page is the login screen.

Browser checks completed:

- Login eye icon toggles password visibility in both directions; guest entry reaches home.
- Guest profile and in-game labels are visible; bot game launches and deals center cards.
- Leaderboard renders all 80 players and scrolls to the last result.
- Desktop and narrow layouts checked for login, home, rules, bot setup/game, tournament setup, rankings, signup, player statistics, multiplayer setup, matchmaking and feedback form.
- Tournament bracket and match-page layouts checked with synthetic room data.
- Narrow game board and controls fit without horizontal overflow.
- No application console errors in the checked pages.

## Boundaries

Live PeerJS signalling, two-device networking and production Firebase writes were not exercised. Result regression tests run the actual multiplayer code against database spies. The repository contains no Firebase security rules or server-side match writer; guest protection is implemented in the existing client-side result path. Guest protection applies to the updated clients; existing open tabs should reload after deployment.

The Game History navigation points to an external site whose source is not in this repository. SlapsGame itself writes account totals/extended statistics; those writes are blocked for guest matches. Tournament bracket progress remains local/in-session and is not a ranked account statistic.

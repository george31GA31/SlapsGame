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

## Account, preferences and card-layout update

`npm test` now runs 18 checks, including bounded hidden-card pointer movement, click suppression after dragging, mirrored/validated position messages, normal tap behaviour, the host rejecting face-down plays, profile field isolation, account/guest guards and persisted appearance preferences. Account email changes use Firebase's verification flow; password changes use its reset email flow.

Additional browser QA used isolated Firebase fixtures and a two-tab BroadcastChannel transport with the real multiplayer engine. Both players started rounds, and hidden-card positions mirrored between desktop tabs and between a mobile viewport and desktop. A pointer drag retained the card back. Bot gameplay started and dealt cards. Desktop/mobile checks cover the controls outside the board, settings, account form, and mode-entry panels. Test-only URLs: `multiplayer-game.html?qaPeer=host` and `multiplayer-game.html?qaPeer=join`; `account.html?qaMember=1` enables an editable synthetic account. These switches are only interpreted by the preview fixture script, which is never loaded by production HTML.

Live Firebase profile writes, real verification/reset emails, physical touch devices, and public PeerJS signalling were not used for these checks. Online clients must reload together to support the new `CARD_LAYOUT` position message. Its payload contains only an opaque card ID and normalised coordinates; it never includes a face image or rank. The pre-existing peer protocol still exchanges full dealt-card state and is not an anti-cheat boundary. Arrangement does not change a card's lane, ownership, face state, hand order or legal-play eligibility.

# Gameplay and competition update — review and release boundaries

This branch is not a claim that production is secure or the new competitions are live.

## Free-plan release update

Superseded by the next Spark release described in `RELEASE-SPARK.md`: casual room transactions replace disabled competition entry. The notes below describe the initial release's boundaries.

The owner has selected Firebase Spark only. Do not deploy Functions or upgrade billing.
Online competition entry is disabled with an explicit availability message; the callable implementation remains in the repository for future work.
Use `database.rules.free-plan.json` as the complete rules replacement for the previously supplied public-root rules, not the older additions snippet. Firebase publication still requires the owner: it has not been performed here.
Public leaderboard and opponent lookups now use `publicPlayers`; private `users`, history and photos are owner-only under those rules. Existing accounts publish an allowlisted public card when visiting Home while signed in; dormant users will be absent until they do so. No historical account records are deleted.
These are privacy boundaries, not trusted ranked results: users can still modify their own statistics. The rules JSON parses locally but has not been validated in a Firebase emulator or against the live project. Do not claim production security verification.

## Audit findings

The previous app used PeerJS/WebRTC, host-authoritative move/slap decisions, full dealt-card state shared with the guest, and client-written Firebase ELO/statistics. A guest could send host-only events; additional connections could replace the opponent; ghost cards accepted remote image URLs. Disconnects immediately awarded a win. There are no deployed database rules, server credentials or Firebase administration access in this checkout.

The old friend tournament calls an undefined `handleWin`, identifies players by display name, uses match IDs shared between unrelated tournaments, lacks host transfer and stores bracket state in DOM/local storage. The tournament setup now routes Host/Join to the new competition page while retaining the existing solo-bot option. Legacy URLs remain intact for compatibility.

The slap-stack graphic was bound to slaps won rather than physical holdings. Foundation stacking contexts hid moving cards beneath the centre zone. The old flip displayed only the new face squashing horizontally. Old bot slap callbacks were not bound to the opportunity that scheduled them.

## Implemented

- Two-sided 160 ms perspective flip, with face visibility switching at the edge-on midpoint; cancellation and reduced-motion support. Rules remain immediately playable.
- Shared stacking context, physical penalty-card counters, pointer slaps on either centre pile, keyboard support, pointer cancellation and single active card drag.
- Bot reaction minimum of 250 ms after the reveal midpoint, varied timing, hesitation at every level, and opportunity-specific slap timers.
- Bounded peer messages, role checks, rejection of additional peers, local-card-derived ghost images, ordered reconnect replay and a 20-second same-page reconnection grace period.
- Host slap input delayed by half the measured RTT (bounded at 300 ms) to approximate the guest's transit cost. This mitigates host advantage; it is not neutral-server arbitration and cannot guarantee identical fairness under asymmetric/jittery links or a modified host.
- Opponent introduction, results presentation, Shop placeholder, profile-photo cropping/re-encoding, and private-path online history. Existing guest matches remain excluded from personal statistics/history.
- Responsive rules page transcribing 514 numbered sections/provisions from the supplied v1.2 PDF, with grouped Laws A–I and online control explanation. Original numbering and references are retained. The PDF has cross-references to disciplinary Law I although its Law I describes competition; these have not been silently rewritten.
- Firebase callable competition service and UI: eight-player knockout; 2–20-player single round robin; ready checks; stable authenticated identities; server-timed host transfer; result agreement; concession/absence processing; idempotent histories; shared-rank league standings.
- Online league ordering is points, round difference, rounds won, slap difference, slaps won. Exact ties share rank. This implements the requested sequential tiebreaks and is explicitly distinguished from PDF Law I.3.5's combined formula.

## Required before release

1. Inspect/export the **current** Firebase rules and account schema. Merge `database.rules.additions.json` as children of the existing `rules` object. It is deliberately not configured as a complete replacement: doing so could break authentication/profile/ranking flows. Remove any ancestor grant that makes these private/server-only paths public or writable. Firebase child rules cannot revoke ancestor permissions.
2. Deploy the callable service in `functions/` to the existing `isf-log-ins` project. `firebase deploy --only functions:competitionAction --project isf-log-ins` after authenticated setup and dependency installation. The callable verifies Firebase authentication and uses Admin SDK credentials supplied by the runtime, not client secrets. New backend deployment may require the project's billing setup.
3. Test rules in the Firebase emulator and with separate production test accounts: nonmembers cannot read rooms, no client can write competitions, another user cannot read history/photos, profile fields do not expose private account information. The additions do not repair unknown existing `/users` rules or migrate ELO writes to a referee service.
4. Validate two real devices on different networks: signalling, ICE/NAT traversal, same-page reconnection, low-power frame rates, delayed/jittered simultaneous slaps, mobile backgrounding and the new protocol. Both clients must load this release; legacy wire messages do not have the replay envelope.
5. End-to-end verify the deployed tournament/league service, all seven tournament matches, host departure, league results and photo/history persistence. Browser competition previews are synthetic; reducer tests are not live Firebase tests.

## Remaining limitations

- Ranked peer gameplay is **not cheat-proof**. Peers still know hidden cards and self-report account statistics. Account protection cannot be certified without live Firebase rules. A neutral authoritative match server, hidden-information filtering and server-only ranked results remain further work.
- Reloading/closing a live match page does not reconstruct its engine state. The new replay restores interruptions only while the page remains open. Competition state itself persists on the server and can be rejoined; unresolved matches need concession or the absence policy.
- A network partition lasting beyond the grace period can produce disagreeing local outcomes. Competition advancement is held as disputed rather than silently choosing a winner. A participant may concede to resolve a dispute; automated neutral arbitration is not implemented.
- Unchanged core engines contain legacy rule approximations: new rounds regenerate a shuffled deck from totals rather than preserving exact card identities, and some shortage/misslap/concession behaviour differs from the PDF. Those behaviours need a separately verified rules-engine migration rather than untested changes hidden in a presentation patch.
- Profile images are stored at a separate own-user-readable path and shown on the profile. Opponent portraits currently use name cards; there is no public photo sharing policy.
- Previous account totals cannot reconstruct historic individual matches. Personal history begins with this update.

## Verification

Run `npm test` (51 passing checks). Tests cover existing account/guest behaviour, card handling, 3D faces, draw-reveal execution, legal simultaneous plays, physical slap holdings, message bounds, reconnect ordering, capacities, 190 unique league fixtures, full knockout progression, result disagreement/idempotency, host transfer and absence timing.

Local Chromium checks used synthetic Firebase services and a two-tab BroadcastChannel transport running the real multiplayer engines. Both players received ten Foundation cards and entered active play. No JavaScript errors. Viewport/document dimensions matched at 1366×768, 768×1024, 390×844, 320×568 and 844×390. Rules, Shop, Account and History showed no horizontal overflow at 390 px. These are emulated screens, not physical-device or production-backend tests.

References: [Firebase callable functions](https://firebase.google.com/docs/functions/callable), [Realtime Database rule precedence](https://firebase.google.com/docs/database/security/core-syntax).

Synthetic browser competition checks rendered all seven knockout fixtures and all 190 league fixtures with no JavaScript errors and no page overflow at 390 px. Bracket connectors and player frames were visually inspected.

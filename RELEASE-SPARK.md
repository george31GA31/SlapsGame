# Spark release: player visibility, casual competitions and Home

No billing upgrade or Cloud Functions deployment is required.

## Why only one player appeared

The previous release moved ranking reads from private `users` to `publicPlayers`, but only mirrored accounts when they visited Home. Nothing deleted other account records. Every signed-in page now maintains the allowlisted public card; public views use usernames, not private first/last names. Authentication changes detach old listeners.

Dormant accounts still require a one-time owner migration. In Firebase Console export the `users` node to a local JSON file. Keep this export private and out of GitHub. Run:

    node scripts/migrate-public-players.cjs users-export.json > public-players.json

Review the generated file: it must contain only usernames, country/flag and aggregate statistics. Import it into the **publicPlayers node**, never the root. Export that node first if it already contains records you need to retain. Use a fresh users export immediately before migration, ideally while players are not playing: importing an older snapshot can temporarily replace more recent public totals. Private records are not modified; returning players resync their latest totals.

## Firebase rules rollout

Publish the complete `database.rules.free-plan.json` in Realtime Database → Rules. It preserves owner-only private account/history/photo access and adds `casualCompetitions`. The old `competitions` server-only path stays locked.

Casual rooms are readable by signed-in nonanonymous users who possess a 12-character room code; the room collection cannot be listed. Existing members can manage room state, and new users can join lobbies. These are explicitly **trusted-friends competitions**, not secure ranked events: a modified member client can manipulate room results. No casual result changes ranked account totals.

Joining, ready checks, simultaneous changes, bracket progression, host transfer, result agreement and reconnection use RTDB transactions with the shared reducer. Empty Firebase arrays and missing bracket slots are normalized. The UI gives an actionable message until these new rules are deployed.

## Interface

Home is public and starts a guest session for a first-time play click. Existing sign-in and solo/friend/online setup routes remain available. Desktop rankings and active league standings sit on the right; narrower screens stack them. All 24 HTML pages use the root `ISF_favicon.png`.

## Release boundaries

Validation: 57 Node checks pass. The RTDB emulator passes owner privacy and public allowlist tests, concurrent joins/results, all seven knockout matches, 190 completed league fixtures and host transfer. Chromium checks show no Home overflow at 320/390/768/1024/1440 pixels; tournament and league screens render 8/20 players and 7/190 fixtures at phone/desktop widths, with desktop standings to the right. These checks use test data, not live account records.

To rerun emulator checks, install firebase-tools 14.27.0, Firebase and @firebase/rules-unit-testing as local development tools, then run `firebase emulators:exec --project demo-slaps --only database --config firebase.emulator.json 'node tests/firebase-emulator.cjs'`. Java 17 was used for this check. This command uses an isolated demo project.

The Firebase connection is still unavailable in this workspace. Code commits do not publish rules or migrate account data. Real production account/network verification must follow owner rule publication. Full match-page reload recovery and neutral anti-cheat arbitration remain outside this change.

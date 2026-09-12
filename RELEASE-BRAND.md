# Slaps presentation release

This release extends the Arena's cream, forest green and lime presentation to all 20 non-gameplay pages. The supplied ISF logos are original, unmodified files. Light menus use the dark logo; dark menus use the cream logo. New visitors see the cream design; an existing saved appearance preference is retained. All 24 pages retain the requested favicon.

The four gameplay pages retain their table design. Separate slap-pile display elements have been removed. A lower-right widget reads `playerSlapCards` and `aiSlapCards`, never the number of slaps won. The phone-only centre grid now uses the full width of its middle column, removing the legacy 50% width that displaced it to the left.

Account photos now have an explicit square crop editor with pointer dragging, keyboard positioning, zoom, cancel and save. Output remains a 256×256 metadata-free JPEG in the existing owner-only `profilePictures` path. The signed-in user's photo appears on Home and match introductions/results. Practice uses a local account-photo cache cleared by logout/guest entry. Photos are not published to opponents or public profiles; those continue to use names/initials under the existing privacy rules.

## Verification

- 57 existing Node regression tests pass, including simultaneous actions, reconnection replay, physical-card counts, account isolation and competition progression.
- Local Chromium checks across 22 pages at 320, 390, 768 and 1440 pixels: no page JavaScript errors or document-width overflow. Pre-match pages retain their existing state-dependent entry flow.
- Centre alignment and visible counter bounds checked at 320, 375, 390, 430, 768 and 1440 pixels. Centre offset is zero at each size.
- Crop, zoom, keyboard reposition and save exercised in the browser against an isolated database stub; output is a bounded JPEG and saving dismisses the editor.
- Rendered populated eight-player knockout and twenty-player/190-fixture league at desktop and phone widths; all players render and desktop standings remain on the right.
- Saved light/dark appearance and corresponding logo checked in the browser.

## Deployment and multiplayer scope

Publish through the existing GitHub Pages deployment from `main`. This update needs no Firebase rules change, paid service or transport migration.

No live cross-device latency measurements were available for this release, so the PeerJS/WebRTC architecture, event protocol and match ownership remain unchanged. Current matches are peer-host-authoritative, not neutrally server-authoritative. No stronger anti-cheat claim is made. Earlier Firebase competition-rule rollout and public-player migration prerequisites in `RELEASE-SPARK.md` remain separate from this presentation release and are not certified deployed here.

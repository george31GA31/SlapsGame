# Canonical Slaps rules engine

This file defines the behavioural contract for the rebuild.

## Principle

Gameplay rules must live in a DOM-free rules layer. HTML, animations, PeerJS/Firebase transport and presentation may display or carry a decision, but they must not decide whether the move was legal.

## Canonical gameplay rules

- Standard deck: 52 cards, values 2 through ace (14).
- A card can be played on a centre pile only when its value is one step above or below the top card.
- Ace and 2 are adjacent.
- A slap is available only when both centre-pile top cards have the same rank.
- A player may have at most four face-up Foundation cards across the mat. A covered or currently unplayable face-up card still counts.
- Ten-card hands start in four stacks of 4, 3, 2 and 1. After the deal, each card has a position and stacking order within the player's mat. Moving a card leaves its face state and ownership intact.
- A visible portion makes a card accessible for rearrangement. Flipping and playing require full exposure. Only a face-up card with a legal Centre Pile target can leave the mat. A release is checked against the current Centre Piles.
- During active play either player may request a coordinated Draw Deck reveal. Natural stalemates still account for legal plays and available Foundation preparation. Requests against the same reveal revision coalesce. The next revision accepts a new request immediately.
- Any odd card removed during an even pot split must be carried explicitly into the next transition, never silently discarded.

## State ownership target

The eventual canonical match state should own:

- player/opponent totals
- draw decks
- Foundation hands, mat bounds, card positions and stacking order
- centre piles
- exposed/covered status
- penalties
- ready state
- match phase
- slap availability
- round/match result
- monotonically increasing action and reveal revisions

Presentation state such as DOM classes, animations, dragged pixels and overlays must not be used to determine a gameplay phase.

## Published rulebook references

Laws D.2 and D.3 cover Foundation arrangement and the boundary. A.4.7, E.4 and G.10.2 describe natural stalemates and restarts. A player-initiated forced reveal during active play is an online rule and should be identified separately in the published rules.

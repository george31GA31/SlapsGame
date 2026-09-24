# Canonical Slaps rules engine

This file defines the behavioural contract for the rebuild.

## Principle

Gameplay rules must live in a DOM-free rules layer. HTML, animations, PeerJS/Firebase transport and presentation may display or carry a decision, but they must not decide whether the move was legal.

## Canonical rules captured in v1

- Standard deck: 52 cards, values 2 through ace (14).
- A card can be played on a centre pile only when its value is one step above or below the top card.
- Ace and 2 are adjacent.
- A slap is available only when both centre-pile top cards have the same rank.
- A player may have at most four exposed foundation cards.
- A covered card cannot be flipped. Only the current top card in its lane may be exposed.
- A card that is already in-flight awaiting authoritative move confirmation must not continue consuming an exposed-card slot.
- Ten-card hands use the existing 4/3/2/1 lane shape. Smaller hands are distributed round-robin across four lanes.
- Any odd card removed during an even pot split must be carried explicitly into the next transition, never silently discarded.

## State ownership target

The eventual canonical match state should own:

- player/opponent totals
- draw decks
- foundation hands and lane order
- centre piles
- exposed/covered status
- penalties
- ready state
- match phase
- slap availability
- round/match result
- monotonically increasing revision number

Presentation state such as DOM classes, animations, dragged pixels and overlays must not be used to determine a gameplay phase.

## Migration order

1. Shared pure helpers and invariant tests.
2. Bot game delegates core legality/flip/slap rules to the engine.
3. Online mode delegates the same rules and stops counting pending cards as playable hand state.
4. Move/flip actions become fully authoritative and revisioned.
5. Reconnect uses canonical snapshots instead of trying to reconstruct state from UI/event history.
6. Ranked/tournament results eventually come from authoritative match state rather than client claims.

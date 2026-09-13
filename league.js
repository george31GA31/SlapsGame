// League-specific presentation; shared room transport remains in competitions.js.
window.CompetitionView={
 title:'The league',
 groups:room=>[...new Set(room.matches.map(m=>m.round))],
 heading:round=>'Matchday '+round,
 fixtureLabel:match=>'Player 1 → Player 2 · '+match.status
};

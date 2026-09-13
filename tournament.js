// Knockout-specific presentation; brackets use explicit progression edges.
window.CompetitionView={
 title:'The knockout',
 groups:room=>[...new Set(room.matches.map(m=>m.round))],
 heading:(round,total)=>round===total?'Final · ♛':round===total-1?'Semi-finals':round===total-2?'Quarter-finals':'Round of '+2**(total-round+1),
 fixtureLabel:match=>match.reason==='bye'?'BYE · AUTOMATIC ADVANCEMENT':match.status
};

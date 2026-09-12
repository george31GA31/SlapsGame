/* Public player cards deliberately contain no email address, real name, history or photo. */
window.ISFPublicPlayer = {
  fromPrivate(profile) {
    const number = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
    return {
      username: String(profile.username || 'PLAYER').slice(0, 30),
      country: String(profile.country || '').slice(0, 4),
      flag: String(profile.flag || '').slice(0, 180),
      elo: number(profile.elo, 1000), wins: number(profile.wins), losses: number(profile.losses),
      stats_slaps_won: number(profile.stats_slaps_won), stats_slaps_lost: number(profile.stats_slaps_lost),
      stats_rounds_won: number(profile.stats_rounds_won), stats_rounds_lost: number(profile.stats_rounds_lost),
      stats_total_time_sec: number(profile.stats_total_time_sec)
    };
  },
  async sync(uid, profile) {
    if (!window.db || !uid || !profile) return;
    await window.db.ref('publicPlayers/' + uid).set(this.fromPrivate(profile));
  }
};

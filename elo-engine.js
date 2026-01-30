// elo-engine.js

/**
 * 1. GET THE K-FACTOR
 * Rules:
 * - 0-5 games: K=64
 * - 6-15 games: K=32
 * - 16-30 games: K=16
 * - 30+ games: K=8
 * - SPECIAL RULE: If opponent has <= 5 games, halve the K-Factor.
 */
function getKFactor(myGameCount, opponentGameCount) {
    let k = 8; // Default for veterans (30+ games)

    // Determine Base K based on MY experience
    if (myGameCount <= 5) {
        k = 64;
    } else if (myGameCount <= 15) {
        k = 32;
    } else if (myGameCount <= 30) {
        k = 16;
    }

    // Apply Special Rule: Halve K if playing a "Newbie"
    if (opponentGameCount <= 5) {
        k = k / 2;
        console.log("Opponent is new (<=5 games). K-Factor halved to:", k);
    }

    return k;
}

/**
 * 2. CALCULATE THE NEW RATING
 * Uses the formula: 1 / (1 + 10^((OpponentElo - MyElo) / 400))
 */
function calculateNewElo(myElo, opponentElo, isWin, myGameCount, opponentGameCount) {
    // A. Get the K-Factor using the rules above
    const kFactor = getKFactor(myGameCount, opponentGameCount);

    // B. Calculate Expected Score (Probability of winning)
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));

    // C. Define Actual Score (1 = Win, 0 = Loss)
    const actualScore = isWin ? 1 : 0;

    // D. The Final Formula
    // NewRating = OldRating + K * (Actual - Expected)
    const newRating = myElo + kFactor * (actualScore - expectedScore);

    // Return the new rating rounded to the nearest whole number
    return Math.round(newRating);
}

// elo-engine.js

/**
 * Determines the K-Factor based on ISF Rules:
 * 0-5 games: K=64
 * 6-15 games: K=32
 * 16-30 games: K=16
 * 30+ games: K=8
 * RULE: If opponent has <= 5 games, your K is halved.
 */
function getKFactor(myGameCount, opponentGameCount) {
    let k = 8; // Default for 30+ games

    // 1. Determine Base K based on MY experience
    if (myGameCount <= 5) {
        k = 64;
    } else if (myGameCount <= 15) {
        k = 32;
    } else if (myGameCount <= 30) {
        k = 16;
    }

    // 2. Apply Special Rule: Halve K if opponent is a "Newbie"
    if (opponentGameCount <= 5) {
        k = k / 2;
        console.log("Opponent is new (<=5 games). K-Factor halved to:", k);
    }

    return k;
}

/**
 * Calculates new ELO based on ISF weighted rules.
 */
function calculateNewElo(myElo, opponentElo, isWin, myGameCount, opponentGameCount) {
    // 1. Get the dynamic K-Factor
    const kFactor = getKFactor(myGameCount, opponentGameCount);

    // 2. Calculate Expected Score (The Formula you provided)
    // Formula: 1 / (1 + 10 ^ ((OpponentElo - MyElo) / 400))
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));

    // 3. Define Actual Score
    const actualScore = isWin ? 1 : 0;

    // 4. Calculate New Rating
    const newRating = myElo + kFactor * (actualScore - expectedScore);

    return Math.round(newRating);
}

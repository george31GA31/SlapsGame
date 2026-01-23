function attemptAIMove() {
    // 1. CALCULATE REACTION SPEED
    // We use a linear formula to hit your exact targets:
    // Level 1:  4000ms - 6000ms (Slow)
    // Level 10: 500ms  - 1500ms (Fast)
    
    const diff = gameState.difficulty;
    
    // Math to scale nicely between Level 1 and 10
    const minTime = 4000 - ((diff - 1) * 388); // Ends at ~500ms
    const maxTime = 6000 - ((diff - 1) * 500); // Ends at ~1500ms
    
    // Pick a random time in that range
    const reactionDelay = Math.random() * (maxTime - minTime) + minTime;

    // --- REST OF THE AI LOGIC ---
    
    // 1. PRIORITY: CAN I PLAY A CARD?
    const activeCards = gameState.aiHand.filter(c => c.isFaceUp);
    let bestMove = null;

    for (let card of activeCards) {
        if (checkPileLogic(card, gameState.centerPileLeft)) {
            bestMove = { card: card, target: 'left' };
            break; 
        }
        if (checkPileLogic(card, gameState.centerPileRight)) {
            bestMove = { card: card, target: 'right' };
            break;
        }
    }

    if (bestMove) {
        gameState.aiProcessing = true; 
        
        // Use the calculated delay
        console.log(`AI Difficulty ${diff}: Reacting in ${Math.round(reactionDelay)}ms`);
        
        setTimeout(() => {
            animateAIMove(bestMove.card, bestMove.target, () => {
                playCardToCenter(bestMove.card, bestMove.card.element);
                gameState.aiProcessing = false; 
            });
        }, reactionDelay);
        
        return; 
    }

    // 2. PRIORITY: FLIP A CARD
    if (activeCards.length < 4) {
        const hiddenCard = gameState.aiHand.find(c => !c.isFaceUp);
        if (hiddenCard) {
            gameState.aiProcessing = true;
            
            // Flipping is faster than playing (50% of reaction time)
            setTimeout(() => {
                setCardFaceUp(hiddenCard.element, hiddenCard, 'ai');
                gameState.aiProcessing = false;
            }, reactionDelay * 0.5); 
            return;
        }
    }

    // 3. PRIORITY: STUCK? CLICK DRAW DECK
    if (!bestMove && activeCards.length === 4) {
        if (!gameState.aiReady) {
            gameState.aiProcessing = true;
            // Being stuck takes longer to realize (Wait 2s + reaction)
            setTimeout(() => {
                console.log("AI is stuck. Requesting Draw.");
                gameState.aiReady = true;
                document.getElementById('ai-draw-deck').classList.add('deck-ready');
                gameState.aiProcessing = false;
                checkDrawCondition();
            }, 2000 + reactionDelay);
        }
    }
}

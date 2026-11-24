/* Local tournament result presentation for the shared solo match controller. */
(() => {
    showEndGame = function (_title, isWin) {
        const heading = document.getElementById('msg-title');
        const subtitle = document.getElementById('msg-subtitle');
        const button = document.getElementById('msg-btn');
        heading.textContent = isWin ? 'ROUND CLEARED!' : 'ELIMINATED!';
        heading.style.color = isWin ? '#66ff66' : '#ff4444';
        subtitle.textContent = isWin ? 'Proceeding to the next stage...' : 'Better luck next time.';
        button.textContent = isWin ? 'NEXT MATCH' : 'EXIT TOURNAMENT';
        button.classList.remove('hidden');
        button.onclick = () => { location.href = isWin ? 'tournament-match.html' : 'index.html'; };
        document.getElementById('game-message').classList.remove('hidden');

        if (isWin) {
            const current = Number.parseInt(localStorage.getItem('isf_tourney_round'), 10) || 0;
            localStorage.setItem('isf_tourney_round', current + 1);
        }
    };
})();

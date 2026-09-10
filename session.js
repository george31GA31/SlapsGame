/* Account guest mode is separate from the PeerJS host/join role. */
window.ISFSession = Object.freeze({
    isGuest() {
        return localStorage.getItem('isf_is_guest') === 'true';
    },
    clear() {
        // Preserve unrelated site preferences and other applications' storage.
        Object.keys(localStorage).filter(key => key.startsWith('isf_'))
            .forEach(key => localStorage.removeItem(key));
    },
    async startGuest() {
        // Do not leave a previously signed-in account attached to guest play.
        if (window.isfAuthReady) await window.isfAuthReady;
        if (window.auth) await window.auth.signOut();
        this.clear();
        const name = 'Guest-' + Array.from(crypto.getRandomValues(new Uint8Array(3)), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
        localStorage.setItem('isf_is_guest', 'true');
        localStorage.setItem('isf_username', name);
        localStorage.setItem('isf_my_name', name);
    },
    showMatchStatus(message) {
        let badge = document.getElementById('session-status');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'session-status';
            badge.className = 'session-status';
            badge.setAttribute('role', 'status');
            document.body.appendChild(badge);
        }
        badge.textContent = message;
    }
});

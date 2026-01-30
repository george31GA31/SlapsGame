/* =========================================
   SCRIPT.JS - GUEST LOGIC
   ========================================= */

window.onload = function() {
    checkAuthSession();
};

/* --- 1. SHOW/HIDE LOGIC --- */
function showGuestInput() {
    document.getElementById('state-buttons').classList.add('hidden');
    document.getElementById('state-input').classList.remove('hidden');
    document.getElementById('guest-sidebar-name').focus();
}

function cancelGuestInput() {
    document.getElementById('state-input').classList.add('hidden');
    document.getElementById('state-buttons').classList.remove('hidden');
}

/* --- 2. SAVE NAME LOGIC --- */
function confirmGuestLogin() {
    const nameInput = document.getElementById('guest-sidebar-name');
    const name = nameInput.value.trim().toUpperCase();

    if (!name) {
        alert("Please enter a nickname.");
        return;
    }

    // Save to browser memory
    localStorage.setItem('isf_username', name);
    localStorage.setItem('isf_is_guest', 'true');

    checkAuthSession(); // Refresh UI
}

/* --- 3. CHECK SESSION ON LOAD --- */
function checkAuthSession() {
    const name = localStorage.getItem('isf_username');
    
    const btns = document.getElementById('state-buttons');
    const input = document.getElementById('state-input');
    const profile = document.getElementById('state-profile');
    const displayName = document.getElementById('sidebar-display-name');

    // If elements are missing (e.g. on different page), stop
    if (!btns || !profile) return;

    if (name) {
        // LOGGED IN
        btns.classList.add('hidden');
        input.classList.add('hidden');
        profile.classList.remove('hidden');
        if(displayName) displayName.innerText = name;
    } else {
        // LOGGED OUT
        profile.classList.add('hidden');
        input.classList.add('hidden');
        btns.classList.remove('hidden');
    }
}

function logoutGuest() {
    localStorage.removeItem('isf_username');
    localStorage.removeItem('isf_is_guest');
    checkAuthSession();
}

/* --- 4. PLAY A FRIEND CLICK --- */
function handlePlayFriendClick() {
    const name = localStorage.getItem('isf_username');
    
    if (!name) {
        // If not signed in, open the input box and shake it
        showGuestInput();
        alert("Please create a Guest Name first!");
    } else {
        // If signed in, go to setup
        window.location.href = 'multiplayer-setup.html';
    }
}

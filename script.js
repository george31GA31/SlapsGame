/* =========================================
   SCRIPT.JS - GLOBAL LOGIC
   ========================================= */

window.onload = function() {
    checkAuthSession();
};

/* --- 1. SIDEBAR UI LOGIC --- */

function showGuestInput() {
    // Hide Buttons, Show Input
    document.getElementById('state-buttons').classList.add('hidden');
    document.getElementById('state-input').classList.remove('hidden');
    document.getElementById('state-input').classList.add('fade-in');
    
    // Focus on the text box so you can type immediately
    document.getElementById('guest-sidebar-name').focus();
}

function cancelGuestInput() {
    // Hide Input, Show Buttons
    document.getElementById('state-input').classList.add('hidden');
    document.getElementById('state-buttons').classList.remove('hidden');
    document.getElementById('state-buttons').classList.add('fade-in');
}

/* --- 2. LOGIN LOGIC --- */

function confirmGuestLogin() {
    const nameInput = document.getElementById('guest-sidebar-name');
    const name = nameInput.value.trim().toUpperCase();

    if (!name) {
        alert("Please enter a nickname.");
        return;
    }

    // Save Name to Browser Memory
    localStorage.setItem('isf_username', name);
    localStorage.setItem('isf_is_guest', 'true');

    // Update UI
    checkAuthSession();
}

function logoutGuest() {
    localStorage.removeItem('isf_username');
    localStorage.removeItem('isf_is_guest');
    location.reload(); // Refresh page to reset
}

function checkAuthSession() {
    const name = localStorage.getItem('isf_username');
    
    // Get Elements
    const btns = document.getElementById('state-buttons');
    const input = document.getElementById('state-input');
    const profile = document.getElementById('state-profile');
    const displayName = document.getElementById('sidebar-display-name');

    // Safety check (if elements exist on this page)
    if (btns && profile) {
        if (name) {
            // LOGGED IN: Show Name
            btns.classList.add('hidden');
            input.classList.add('hidden');
            profile.classList.remove('hidden');
            profile.classList.add('fade-in');
            if(displayName) displayName.innerText = name;
        } else {
            // LOGGED OUT: Show Buttons
            profile.classList.add('hidden');
            input.classList.add('hidden');
            btns.classList.remove('hidden');
        }
    }
}

/* --- 3. GAME BUTTON LOGIC --- */

function hostMatch() {
    // Check if user is signed in
    const name = localStorage.getItem('isf_username');
    
    if (!name) {
        // If not signed in, open the sidebar input and alert them
        showGuestInput();
        alert("Please create a Guest Name in the sidebar first!");
    } else {
        // If signed in, go to the Multiplayer Setup page (Screenshotted code)
        window.location.href = 'multiplayer-setup.html';
    }
}
/* --- 4. UNIVERSAL GAME BUTTON LOGIC --- */
function handleGameMode(url) {
    const name = localStorage.getItem('isf_username');
    
    if (!name) {
        // NO NAME FOUND: Stop them, open sidebar input, and alert
        showGuestInput();
        // highlight the input box to make it obvious
        const input = document.getElementById('guest-sidebar-name');
        if(input) {
            input.style.boxShadow = "0 0 15px #ff4444";
            setTimeout(() => input.style.boxShadow = "none", 500);
        }
        alert("Please enter a Nickname in the sidebar to play!");
    } else {
        // NAME FOUND: Let them pass to the requested page
        window.location.href = url;
    }
}

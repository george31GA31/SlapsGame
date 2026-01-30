/* =========================================
   SCRIPT.JS - GLOBAL LOGIC
   ========================================= */

window.onload = function() {
    checkAuthSession();
    updateGlobalNicknames(); // <--- This fixes the name on other pages
};

/* --- 1. GUEST SIDEBAR LOGIC --- */
function showGuestInput() {
    const btns = document.getElementById('state-buttons');
    const input = document.getElementById('state-input');
    if(btns) btns.classList.add('hidden');
    if(input) input.classList.remove('hidden');
    const nameBox = document.getElementById('guest-sidebar-name');
    if(nameBox) nameBox.focus();
}

function cancelGuestInput() {
    document.getElementById('state-input').classList.add('hidden');
    document.getElementById('state-buttons').classList.remove('hidden');
}

function confirmGuestLogin() {
    const nameInput = document.getElementById('guest-sidebar-name');
    const name = nameInput.value.trim().toUpperCase();

    if (!name) {
        alert("Please enter a nickname.");
        return;
    }

    localStorage.setItem('isf_username', name);
    localStorage.setItem('isf_is_guest', 'true');

    checkAuthSession();
    updateGlobalNicknames(); // Update names immediately
}

function checkAuthSession() {
    const name = localStorage.getItem('isf_username');
    
    // Sidebar Elements
    const btns = document.getElementById('state-buttons');
    const input = document.getElementById('state-input');
    const profile = document.getElementById('state-profile');
    const displayName = document.getElementById('sidebar-display-name');

    // Only run if we are on a page with the sidebar
    if (btns && profile) {
        if (name) {
            btns.classList.add('hidden');
            input.classList.add('hidden');
            profile.classList.remove('hidden');
            if(displayName) displayName.innerText = name;
        } else {
            profile.classList.add('hidden');
            input.classList.add('hidden');
            btns.classList.remove('hidden');
        }
    }
}

function logoutGuest() {
    localStorage.removeItem('isf_username');
    localStorage.removeItem('isf_is_guest');
    location.reload(); 
}

/* --- 2. GLOBAL NAME UPDATER (Fixes Tournament/Online Pages) --- */
function updateGlobalNicknames() {
    const name = localStorage.getItem('isf_username') || "GUEST";
    
    // 1. Update the Modal Name
    const modalName = document.getElementById('modal-player-name');
    if(modalName) modalName.innerText = name;

    // 2. Update any element with class 'display-player-name' on ANY page
    const nameDisplays = document.querySelectorAll('.display-player-name');
    nameDisplays.forEach(el => el.innerText = name);
    
    // 3. Update specific IDs if you used them on other pages
    const specificID = document.getElementById('current-player-name');
    if(specificID) specificID.innerText = name;
}

/* --- 3. PLAY A FRIEND LOGIC --- */
function handlePlayFriendClick() {
    const name = localStorage.getItem('isf_username');
    
    if (!name) {
        // Shake the sidebar input or alert
        showGuestInput();
        alert("Please create a Guest Name in the sidebar first!");
    } else {
        // Open the Modal
        const modal = document.getElementById('play-friend-modal');
        modal.classList.remove('hidden');
        modal.style.display = 'flex'; // Force flex to center
    }
}

function closePlayModal() {
    const modal = document.getElementById('play-friend-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

function startHosting() {
    const name = localStorage.getItem('isf_username');
    const code = Math.floor(100000 + Math.random() * 900000);
    
    localStorage.setItem('isf_role', 'host');
    localStorage.setItem('isf_code', code);
    localStorage.setItem('isf_my_name', name);

    window.location.href = 'multiplayer-setup.html'; // Or whatever your lobby page is named
}

function joinGame() {
    const name = localStorage.getItem('isf_username');
    const codeInput = document.getElementById('join-code-input').value;

    if (!codeInput || codeInput.length < 6) {
        alert("Please enter a valid 6-digit code.");
        return;
    }

    localStorage.setItem('isf_role', 'guest');
    localStorage.setItem('isf_code', codeInput);
    localStorage.setItem('isf_my_name', name);

    window.location.href = 'multiplayer-setup.html';
}

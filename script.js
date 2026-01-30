/* =========================================
   SCRIPT.JS - GLOBAL UI LOGIC
   ========================================= */

// 1. RUN ON PAGE LOAD
// This checks if the user is already remembered as a guest
window.onload = function() {
    checkGuestSession();
};

/* ========================
   GUEST MODAL LOGIC
   ======================== */

function openGuestModal() {
    const modal = document.getElementById('guest-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex'; // Force flex to center it
    }
}

function closeGuestModal() {
    const modal = document.getElementById('guest-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

function saveGuestIdentity() {
    const nameInput = document.getElementById('guest-name-input');
    const nationInput = document.getElementById('guest-nation-input');

    const name = nameInput.value.trim().toUpperCase();
    const nation = nationInput.value;

    if (!name) {
        alert("Please enter a nickname.");
        return;
    }

    // Save to Browser Storage
    localStorage.setItem('isf_username', name);
    localStorage.setItem('isf_nation', nation);
    localStorage.setItem('isf_is_guest', 'true');

    // Update the UI immediately
    checkGuestSession();
    closeGuestModal();
}

/* ========================
   SESSION CHECK & UI UPDATE
   ======================== */

function checkGuestSession() {
    const name = localStorage.getItem('isf_username');
    const nation = localStorage.getItem('isf_nation');

    // Get the HTML elements
    const authDiv = document.getElementById('auth-actions');
    const profileDiv = document.getElementById('user-profile');
    const nameDisplay = document.getElementById('profile-name');
    const nationDisplay = document.getElementById('profile-nation');

    // If elements don't exist (e.g., on a different page), stop here
    if (!authDiv || !profileDiv) return;

    if (name) {
        // --- LOGGED IN STATE ---
        // Hide the Login/Sign Up buttons
        authDiv.style.display = 'none';
        
        // Show the User Profile
        profileDiv.classList.remove('hidden');
        profileDiv.style.display = 'flex';
        
        // Update Text
        if(nameDisplay) nameDisplay.innerText = name;
        if(nationDisplay) nationDisplay.innerText = nation;
    } else {
        // --- LOGGED OUT STATE ---
        // Show buttons
        authDiv.style.display = 'flex';
        
        // Hide profile
        profileDiv.style.display = 'none';
    }
}

function logoutGuest() {
    // Clear data
    localStorage.removeItem('isf_username');
    localStorage.removeItem('isf_nation');
    localStorage.removeItem('isf_is_guest');
    
    // Refresh page to reset UI
    location.reload();
}

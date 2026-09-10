/* Shared, additive UI: does not replace any game's load handler. */
(() => {
    document.querySelectorAll('[data-password-target]').forEach(button => {
        button.addEventListener('click', () => {
            const field = document.getElementById(button.dataset.passwordTarget);
            const showing = field.type === 'password';
            field.type = showing ? 'text' : 'password';
            button.setAttribute('aria-pressed', String(showing));
            button.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
            button.querySelector('i').className = showing ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        });
    });

    // Associate existing form labels without changing form validation or values.
    document.querySelectorAll('.input-group').forEach((group, index) => {
        const label = group.querySelector('label');
        const field = group.querySelector('input:not([type="hidden"]), select, textarea');
        if (label && field) {
            field.id ||= `field-${index}`;
            label.htmlFor = field.id;
        }
    });

    if (ISFSession.isGuest() && !document.querySelector('.auth-card')) {
        ISFSession.showMatchStatus('GUEST MODE · Unranked · No ELO, history or statistics saved');
        const welcome = document.querySelector('.user-welcome');
        if (welcome) welcome.textContent = 'Playing as Guest';
        ['disp-elo', 'disp-wins', 'disp-country'].forEach(id => {
            const field = document.getElementById(id);
            if (field) field.textContent = '—';
        });
        const logout = document.querySelector('.btn-logout-small');
        if (logout) logout.textContent = 'Exit Guest Mode';
    }
})();

window.ISFPreferences = Object.freeze({
    getTheme() {try {return localStorage.getItem('slaps_theme') === 'dark' ? 'dark' : 'light';} catch {return 'light';}},
    setTheme(theme) {localStorage.setItem('slaps_theme', theme === 'light' ? 'light' : 'dark'); this.apply();},
    apply() {document.documentElement.dataset.theme = this.getTheme();}
});
ISFPreferences.apply();
window.addEventListener('storage', e => {if(e.key === 'slaps_theme') ISFPreferences.apply();});

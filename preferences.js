window.ISFPreferences = Object.freeze({
    getTheme() {try {return localStorage.getItem('slaps_theme') === 'light' ? 'light' : 'dark';} catch {return 'dark';}},
    setTheme(theme) {localStorage.setItem('slaps_theme', theme === 'light' ? 'light' : 'dark'); this.apply();},
    apply() {document.documentElement.dataset.theme = this.getTheme();}
});
ISFPreferences.apply();
window.addEventListener('storage', e => {if(e.key === 'slaps_theme') ISFPreferences.apply();});

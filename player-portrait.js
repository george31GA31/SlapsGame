/* Private portraits: only the signed-in account's photo is read. */
(() => {
 const cacheKey = 'isf_profile_picture';
 const valid = value => typeof value === 'string' && value.length <= 150000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);
 let source = '', detach = () => {};
 const paint = () => document.querySelectorAll('[data-own-photo]').forEach(img => {
  if (source) { if (img.getAttribute('src') !== source) img.src = source; img.hidden = false; }
  else { img.hidden = true; img.removeAttribute('src'); }
 });
 new MutationObserver(paint).observe(document.body, {childList:true, subtree:true});
 // Offline practice can use the account's cached portrait without loading a database SDK.
 // ISFSession.clear removes this key on logout/guest entry. Never send this cache to peers.
 if (typeof auth === 'undefined' || typeof db === 'undefined') {
  const cached = () => {
   let value = ''; try { if (!window.ISFSession?.isGuest()) value = localStorage.getItem(cacheKey); } catch {}
   source = valid(value) ? value : ''; paint();
  };
  cached(); addEventListener('storage', cached); return;
 }
 auth.onAuthStateChanged(user => {
  detach(); source = ''; paint();
  try { localStorage.removeItem(cacheKey); } catch {}
  if (!user || user.isAnonymous) { try { localStorage.removeItem(cacheKey); } catch {} return; }
  const ref = db.ref('profilePictures/' + user.uid);
  const callback = snapshot => {
   if (auth.currentUser?.uid !== user.uid) return;
   const value = snapshot.val();
   source = valid(value) ? value : '';
   try { if (source) localStorage.setItem(cacheKey, source); else localStorage.removeItem(cacheKey); } catch {}
   paint();
  };
  ref.on('value', callback, () => { source = ''; paint(); });
  detach = () => ref.off('value', callback);
 });
})();

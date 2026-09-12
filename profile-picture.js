(() => {
 const input = document.getElementById('profile-picture');
 if (!input) return;
 const status = document.getElementById('account-status');
 const dialog = document.getElementById('photo-editor'), canvas = document.getElementById('photo-canvas');
 const zoom = document.getElementById('photo-zoom'), save = document.getElementById('photo-save');
 const cancel = document.getElementById('photo-cancel'), message = document.getElementById('photo-status');
 const ctx = canvas.getContext('2d');
 let bitmap, owner, scale = 1, x = 0, y = 0, drag;
 const draw = () => {
  if (!bitmap) return;
  scale = Math.max(256 / bitmap.width, 256 / bitmap.height) * Number(zoom.value);
  x = Math.max(256 - bitmap.width * scale, Math.min(0, x));
  y = Math.max(256 - bitmap.height * scale, Math.min(0, y));
  ctx.fillStyle = '#eee9dd'; ctx.fillRect(0, 0, 256, 256);
  ctx.drawImage(bitmap, x, y, bitmap.width * scale, bitmap.height * scale);
 };
 const close = () => { dialog.close(); bitmap?.close?.(); bitmap = null; input.value = ''; input.disabled = false; drag = null; };
 dialog.addEventListener('cancel', event => { event.preventDefault(); if (!save.disabled) close(); });
 cancel.onclick = close;
 input.addEventListener('change', async () => {
  const user = auth.currentUser, file = input.files[0];
  if (!user || user.isAnonymous || ISFSession.isGuest() || !file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
   status.textContent = 'Choose a JPEG, PNG or WebP image up to 5 MB.'; input.value = ''; return;
  }
  input.disabled = true;
  try {
   bitmap = await createImageBitmap(file);
   if (auth.currentUser?.uid !== user.uid) throw Error('Account changed');
   owner = user.uid; zoom.value = '1'; save.disabled = false; message.textContent = '';
   scale = Math.max(256 / bitmap.width, 256 / bitmap.height);
   x = (256 - bitmap.width * scale) / 2; y = (256 - bitmap.height * scale) / 2;
   draw(); dialog.showModal();
  } catch { close(); status.textContent = 'Could not open this photo. Try another image.'; }
 });
 zoom.addEventListener('input', () => {
  const next = Math.max(256 / bitmap.width, 256 / bitmap.height) * Number(zoom.value);
  x = 128 - (128 - x) * next / scale; y = 128 - (128 - y) * next / scale; draw();
 });
 canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || save.disabled) return;
  canvas.setPointerCapture(event.pointerId); drag = {id:event.pointerId, x:event.clientX, y:event.clientY};
 });
 canvas.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const ratio = 256 / canvas.getBoundingClientRect().width;
  x += (event.clientX - drag.x) * ratio; y += (event.clientY - drag.y) * ratio;
  drag.x = event.clientX; drag.y = event.clientY; draw();
 });
 for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { drag = null; });
 canvas.addEventListener('keydown', event => {
  const moves = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
  if (!moves[event.key] || save.disabled) return;
  event.preventDefault(); const [dx,dy] = moves[event.key], step = event.shiftKey ? 16 : 4;
  x += dx * step; y += dy * step; draw();
 });
 save.onclick = async () => {
  if (!bitmap || save.disabled) return;
  save.disabled = true; zoom.disabled = true; cancel.disabled = true;
  try {
   if (auth.currentUser?.uid !== owner) throw Error('Account changed');
   const jpeg = canvas.toDataURL('image/jpeg', .8);
   await db.ref('profilePictures/' + owner).set(jpeg);
   close(); status.textContent = 'Profile picture saved.';
  } catch { message.textContent = 'Could not save your photo. Check your connection and try again.'; }
  finally { save.disabled = false; zoom.disabled = false; cancel.disabled = false; }
 };
})();

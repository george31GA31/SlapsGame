(() => {
 const input=document.getElementById('profile-picture'),preview=document.getElementById('profile-picture-preview');
 if(!input)return;
 const status=document.getElementById('account-status');
 auth.onAuthStateChanged(async user=>{
  preview.removeAttribute('src');
  if(!user||user.isAnonymous)return;
  try{const snapshot=await db.ref('profilePictures/'+user.uid).once('value');const src=snapshot.val();
   if(auth.currentUser?.uid===user.uid&&typeof src==='string'&&src.startsWith('data:image/jpeg;base64,'))preview.src=src;
  }catch{ /* Profile fields can still be edited if the photo is unavailable. */ }
 });
 input.addEventListener('change',async()=>{
  const user=auth.currentUser,file=input.files[0];
  if(!user||user.isAnonymous||ISFSession.isGuest()||!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){status.textContent='Choose a JPEG, PNG or WebP image up to 5 MB.';input.value='';return;}
  input.disabled=true;
  try{
   const bitmap=await createImageBitmap(file);
   const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
   const size=Math.min(bitmap.width,bitmap.height);
   canvas.getContext('2d').drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
   bitmap.close();
   const jpeg=canvas.toDataURL('image/jpeg',.8);
   if(auth.currentUser?.uid!==user.uid)throw Error('Sign in again before saving.');
   await db.ref('profilePictures/'+user.uid).set(jpeg);
   preview.src=jpeg;status.textContent='Profile picture saved.';
  }catch{status.textContent='Could not save your photo. Please try again.';}
  finally{input.disabled=false;input.value='';}
 });
})();

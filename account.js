(() => {
    const form=document.getElementById('account-form'), status=document.getElementById('account-status');
    const country=document.getElementById('country');
    const message=text=>{status.textContent=text;};
    let editingUid=null;
    const member=()=>{const u=auth.currentUser;return u && !u.isAnonymous && !ISFSession.isGuest() && u.uid===editingUid ? u:null;};
    ISFCountries.forEach(c=>{const o=document.createElement('option');o.value=c.code;o.textContent=c.name;country.append(o);});
    auth.onAuthStateChanged(async user=>{
        editingUid=null;form.hidden=true;document.getElementById('account-security').hidden=true;
        if(!user || user.isAnonymous || ISFSession.isGuest()) {message('');document.getElementById('account-guest').hidden=false;return;}
        document.getElementById('account-guest').hidden=true;
        try {
            const snapshot=await db.ref('users/'+user.uid).once('value');
            if(auth.currentUser?.uid!==user.uid)return;
            if(!snapshot.exists()) {message('Your profile could not be found. Please sign in again.');return;}
            const profile=snapshot.val();editingUid=user.uid;
            ['firstName','lastName','username','country'].forEach(key=>document.getElementById(key).value=profile[key]||'');
            document.getElementById('current-email').textContent=user.email||'';
            form.hidden=false;document.getElementById('account-security').hidden=false;message('');
        } catch {message('Unable to load your account. Refresh to try again.');}
    });
    async function action(button, task) {
        button.disabled=true;
        try {await task();} catch(error) {message(error.code==='auth/requires-recent-login'?'Please sign out and sign in again, then retry this change.':error.message||'Unable to save. Please try again.');}
        finally {button.disabled=false;}
    }
    form.addEventListener('submit',e=>{
        e.preventDefault();const user=member();if(!user)return message('Please sign in again.');
        const selected=ISFCountries.find(c=>c.code===country.value);
        const patch=Object.fromEntries(['firstName','lastName','username'].map(k=>[k,document.getElementById(k).value.trim()]));
        patch.username=patch.username.toUpperCase();
        if(!selected || !patch.firstName || !patch.lastName || patch.username.length<3)return message('Complete all profile fields; use at least three characters for your username.');
        patch.country=selected.code;patch.flag=selected.flag;
        action(form.querySelector('button'),async()=>{
            // Update only editable fields: ELO, history and statistics stay intact.
            await db.ref('users/'+user.uid).update(patch);
            if(globalThis.ISFPublicPlayer) await ISFPublicPlayer.sync(user.uid,{...(await db.ref('users/'+user.uid).once('value')).val(),...patch});
            if(!member())return;
            localStorage.setItem('isf_username',patch.username);localStorage.setItem('isf_my_name',patch.username);
            try {await user.updateProfile({displayName:patch.username});message('Profile saved.');}
            catch {message('Profile saved. Your sign-in display name could not be updated; retry Save Profile.');}
        });
    });
    document.getElementById('email-form').addEventListener('submit',e=>{
        e.preventDefault();const user=member();if(!user)return message('Please sign in again.');
        const email=document.getElementById('new-email').value.trim();
        action(e.currentTarget.querySelector('button'),async()=>{await user.verifyBeforeUpdateEmail(email);message('Verification email sent to your new address. Follow its link, then sign in with the new email.');});
    });
    document.getElementById('reset-password').addEventListener('click',e=>{
        const user=member();if(!user?.email)return message('Please sign in again.');
        action(e.currentTarget,async()=>{await auth.sendPasswordResetEmail(user.email);message('Password reset email sent to your current address.');});
    });
})();

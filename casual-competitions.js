/* Competition rooms are reduced in Cloud Functions, not in a player's browser.
   The historic name remains to avoid breaking the page entry points. */
(function(){
 window.CasualCompetitions={
  async action(action){
   const user=auth.currentUser;
   if(!user||user.isAnonymous)throw Error('Sign in to join a competition.');
   if(!firebase?.functions)throw Error('The secure competition service is unavailable. Please reload and try again.');
   const call=firebase.functions('europe-west1').httpsCallable('competitionAction');
   return call(action);
  }
 };
})();

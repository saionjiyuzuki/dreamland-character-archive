export async function resumeAudioContext(ctx:AudioContext){
  if(ctx.state==='suspended') await ctx.resume();
}

export async function guardedPlay(media:HTMLAudioElement){
  try{
    await media.play();
    return true;
  }catch(e){
    console.warn('[Audio] blocked',e);
    return false;
  }
}

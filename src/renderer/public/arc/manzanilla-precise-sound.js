// User-supplied Epidemic Sound recording. Original channels and pitch.
// No synthesis, motor oscillators, filters, pitch shifting or microphone access.
export function createPreciseSound(){
 let context,buffer,gain,source,timer,started=0,cursor=0,lastMove=-Infinity,stopped=true;
 const loopStart=0,loopEnd=1.75;
 const ready=(async()=>{
  try{context=new AudioContext();buffer=await context.decodeAudioData(await(await fetch(new URL('./sounds/precise-dial-licensed.mp3',import.meta.url))).arrayBuffer());
   gain=context.createGain();gain.gain.value=0;gain.connect(context.destination);
  }catch(error){console.warn('[Dial sound] Recording unavailable:',error.message);}
 })();
 function stop(){
  stopped=true;clearTimeout(timer);if(!source)return;
  const now=context.currentTime,old=source;source=null;
  cursor=loopStart+((cursor-loopStart+now-started)%(loopEnd-loopStart));
  gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(0,now,.004);
  old.stop(now+.016);old.onended=()=>old.disconnect();
 }
 return {
  move(delta,volume){
   if(!delta||volume<=0)return;
   lastMove=performance.now();stopped=false;
   void ready.then(()=>{
    if(!buffer||stopped||performance.now()-lastMove>100)return;
    void context.resume().catch(()=>{});const now=context.currentTime;
    if(!source){source=context.createBufferSource();source.buffer=buffer;source.loop=true;
     source.loopStart=loopStart;source.loopEnd=Math.min(loopEnd,buffer.duration);
     source.connect(gain);started=now;source.start(now,cursor);
    }
    gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(Math.min(1,Math.max(0,volume)),now,.004);
    clearTimeout(timer);timer=setTimeout(stop,85);
   }).catch(error=>console.warn('[Dial sound] Playback unavailable:',error.message));
  },stop,
 };
}

/** Startup/room-switch readiness only. No permanent animation loop.
 * Sampling is always deferred, so worker locks created inside a render are not
 * synchronously mistaken for persistent pending work.
 */
export function createViewGate({
  readState,requestFrame,onState=()=>{},
  now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout,
  pollMs=250,quietMs=1000,maxWaitMs=60000
}){
  let status='idle',reason='',epoch=0,timer=null,began=0,pausedAt=0,quietSince=null,snapshot=null,sampling=false;
  const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
  const event=(next,extra={})=>{status=next;onState({status:next,reason,snapshot,...extra});};
  const arm=delay=>{
    if(status!=='waiting'||timer!==null)return;
    const token=epoch;timer=schedule(()=>{timer=null;if(token===epoch&&status==='waiting')sample();},delay);
  };
  const sample=()=>{
    if(status!=='waiting')return;
    sampling=true;
    try{
      snapshot=readState();const time=now();
      if(time-began>=maxWaitMs){clear();event('timeout');return;}
      if(snapshot.ready&&snapshot.activeSplats>0&&!snapshot.pending&&!snapshot.needsFrame){
        if(quietSince===null)quietSince=time;
        const remaining=quietMs-(time-quietSince);
        if(remaining<=0){clear();event('settled');return;}
        arm(Math.min(pollMs,remaining));return;
      }
      quietSince=null;
      if(snapshot.needsFrame)requestFrame();
      arm(pollMs);
    }catch(error){clear();event('error',{error});}finally{sampling=false;}
  };
  return{
    get status(){return status;},
    get snapshot(){return snapshot;},
    begin(nextReason='startup'){
      if(status==='stopped')return;
      epoch++;clear();reason=nextReason;began=now();quietSince=null;snapshot=null;
      event('waiting');arm(0);
    },
    notify(){if(status==='waiting'&&!sampling)arm(0);},
    pause(){
      if(status!=='waiting')return;
      epoch++;clear();pausedAt=now();quietSince=null;status='paused';
    },
    resume(){
      if(status!=='paused')return;
      epoch++;began+=now()-pausedAt;quietSince=null;status='waiting';arm(0);
    },
    cancel(){if(status==='stopped')return;epoch++;clear();quietSince=null;event('cancelled');},
    stop(){epoch++;clear();quietSince=null;status='stopped';}
  };
}

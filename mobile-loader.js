const SOURCE_SHA='b6f31ca6941ec74e8cb746ba568fb5e74fec101b1a11b66521ce0d9ea27d673c';
const SHA=/^[a-f0-9]{64}$/;
export const MOBILE_PRESETS=Object.freeze({
 high:Object.freeze({id:'high',label:'High resolution',renderScale:2,maxPixels:2500000}),
 balanced:Object.freeze({id:'balanced',label:'Balanced resolution',renderScale:1.5,maxPixels:1000000}),
 safe:Object.freeze({id:'safe',label:'Lower resolution',renderScale:1,maxPixels:1000000})
});
export function selectQuality(search='',selected){
  const requested=selected===undefined?new URLSearchParams(search).get('detail'):selected;
  return Object.hasOwn(MOBILE_PRESETS,requested)?requested:'high';
}
export function getMobilePreset(quality='high'){return MOBILE_PRESETS[selectQuality('',quality)];}
export function chooseProfile(nav={}){
 const ua=nav.userAgent??'',ios=/iPhone|iPad|iPod/.test(ua)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
 const mobile=ios||/Android|Mobile/.test(ua)||nav.userAgentData?.mobile===true;
 return{kind:mobile?'mobile':'desktop',ios,requiresStart:mobile};
}
export function readInterrupted(storage){
 try{return JSON.parse(storage?.getItem('apartment-load-attempt')??'null')?.state==='loading';}catch{return false;}
}
export function markAttempt(storage,profile){
 try{storage?.setItem('apartment-load-attempt',JSON.stringify({state:'loading',profile,started:Date.now()}));}catch{}
}
export function clearAttempt(storage){try{storage?.removeItem('apartment-load-attempt');}catch{}}
export function validateCapabilities({webgl2,maxTextureSize,maxArrayLayers},profile){
 if(!webgl2||maxTextureSize<2048||maxArrayLayers<4)throw Error('This browser cannot open the interactive tour. Please use a recent browser with WebGL 2.');
 if(profile==='desktop'&&(typeof DecompressionStream==='undefined'||!globalThis.crypto?.subtle))throw Error('This browser does not support the full tour loader.');
}
export function mobileRenderSize(width,height,quality='high',physicalDPR=1){
 const preset=getMobilePreset(quality),dpr=Number.isFinite(physicalDPR)&&physicalDPR>0?physicalDPR:1;
 const scale=Math.min(preset.renderScale,dpr,Math.sqrt(preset.maxPixels/(width*height)));
 return{width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}

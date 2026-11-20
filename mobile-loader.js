const SOURCE_SHA='b6f31ca6941ec74e8cb746ba568fb5e74fec101b1a11b66521ce0d9ea27d673c';
const SHA=/^[a-f0-9]{64}$/;
export const MOBILE_BUDGET=Object.freeze({lodSplatCount:350000,maxPagedSplats:1048576,numLodFetchers:1});
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
export function validateMobileAsset(asset,base){
 if(asset?.schemaVersion!==1||asset.ready!==true)throw Error('The mobile tour is being prepared. The full desktop tour has not been downloaded.');
 if(asset.kind!=='mobile-paged-rad'||asset.paged!==true||asset.sourceModelSha256!==SOURCE_SHA||asset.sourcePointCount!==5059728||asset.sourceSHDegree!==3||asset.shDegree!==3||!SHA.test(asset.sha256??'')||!Number.isSafeInteger(asset.bytes)||asset.bytes<=0)throw Error('The mobile tour identity could not be verified.');
 if(typeof asset.url!=='string'||!/^mobile\/[A-Za-z0-9_.\/-]+\.rad$/.test(asset.url)||asset.url.split('/').includes('..'))throw Error('The mobile tour location is invalid.');
 const url=new URL(asset.url,base);if(!['http:','https:'].includes(url.protocol))throw Error('The mobile tour requires a web location.');
 return{...asset,url:url.href,renderer:{enableLod:true,pagedExtSplats:false,accumExtSplats:false,...MOBILE_BUDGET}};
}
export async function loadMobileAsset(url,{fetchImpl=fetch,signal}={}){
 const response=await fetchImpl(url,{signal,credentials:'omit',cache:'no-cache'});
 if(!response.ok)throw Error('The mobile tour is unavailable. Please try again later.');
 return validateMobileAsset(await response.json(),url);
}
export function mobileMeshOptions(asset){
 return{url:asset.url,paged:true,lod:true,extSplats:false};
}
export function mobileRenderSize(width,height){
 const scale=Math.min(1,Math.sqrt(1000000/(width*height)));
 return{width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}

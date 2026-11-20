const SOURCE_SHA='b6f31ca6941ec74e8cb746ba568fb5e74fec101b1a11b66521ce0d9ea27d673c';
const SHA=/^[a-f0-9]{64}$/;
export const STATIC_LIMITS=Object.freeze({maxPoints:2000000,maxCompressedBytes:128*1024*1024,maxDecodedSHDegree:1});
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
export function validateStaticAsset(asset,base){
 if(asset?.schemaVersion!==1||asset.ready!==true)throw Error('The compact mobile tour is being prepared.');
 if(asset.kind!=='mobile-static-spz'||asset.sourceModelSha256!==SOURCE_SHA||asset.sourcePointCount!==5059728||asset.sourceSHDegree!==3||asset.paged!==false||asset.lod!==false||asset.hierarchy!==false||asset.opacityEncoding!=='standard-0-1')throw Error('The compact tour identity could not be verified.');
 if(!Number.isSafeInteger(asset.pointCount)||asset.pointCount<=0||asset.pointCount>STATIC_LIMITS.maxPoints||![0,1].includes(asset.shDegree)||!Number.isSafeInteger(asset.bytes)||asset.bytes<=0||asset.bytes>STATIC_LIMITS.maxCompressedBytes||!SHA.test(asset.sha256??''))throw Error('The compact tour exceeds its reviewed limits.');
 if(typeof asset.url!=='string'||!/^mobile-static-v5\/[A-Za-z0-9_.-]+\.spz$/.test(asset.url))throw Error('The compact tour location is invalid.');
 const url=new URL(asset.url,base);if(!['http:','https:'].includes(url.protocol))throw Error('The compact tour requires a web location.');
 return{...asset,url:url.href};
}
export async function loadResidentSpz(metadataURL,{fetchImpl=fetch,signal,onProgress=()=>{}}={}){
 const metadataResponse=await fetchImpl(metadataURL,{signal,cache:'no-cache',credentials:'omit'});
 if(!metadataResponse.ok)throw Error('The compact tour information is unavailable.');
 const asset=validateStaticAsset(await metadataResponse.json(),metadataURL);
 const response=await fetchImpl(asset.url,{signal,cache:'force-cache',credentials:'omit'});
 if(!response.ok)throw Error('The compact tour download is unavailable.');
 const contentLength=response.headers.get('content-length');
 if(contentLength!==null&&(!response.headers.get('content-encoding')||response.headers.get('content-encoding')==='identity')&&Number(contentLength)!==asset.bytes)throw Error('The compact download length differs.');
 if(!response.body)throw Error('This browser cannot stream the compact download.');
 const bytes=new Uint8Array(asset.bytes),reader=response.body.getReader();let loaded=0;
 try{
  for(;;){
   if(signal?.aborted)throw signal.reason??Error('Tour loading cancelled.');
   const item=await reader.read();if(item.done)break;
   if(loaded+item.value.length>bytes.length)throw Error('The compact download exceeds its expected size.');
   bytes.set(item.value,loaded);loaded+=item.value.length;onProgress({phase:'download',loaded,total:asset.bytes});
  }
  if(loaded!==bytes.length)throw Error('The compact download is incomplete.');
  onProgress({phase:'verify',loaded,total:asset.bytes});
  if(await hash(bytes)!==asset.sha256)throw Error('The compact download failed its integrity check.');
  if(signal?.aborted)throw signal.reason??Error('Tour loading cancelled.');
  return{asset,fileBytes:bytes,meshOptions:{fileBytes:bytes,fileType:'spz',lod:false,extSplats:false},verified:true};
 }catch(error){await reader.cancel(error).catch(()=>{});throw error;}
 finally{reader.releaseLock();}
}
export function residentMeshOptions(delivery,{extended=false}={}){
 return{fileBytes:delivery.fileBytes,fileType:'spz',lod:false,paged:false,extSplats:extended};
}
export function residentRendererOptions(){return{enableLod:false,enableDriveLod:false,enableLodFetching:false,pagedExtSplats:false,accumExtSplats:false,autoUpdate:false};}
export function validateResidentDecoded(mesh,asset){
 const source=mesh?.extSplats??mesh?.packedSplats;
 if(!source||mesh.numSplats!==asset.pointCount||source.numSplats!==asset.pointCount)throw Error('The decoded compact point count differs.');
 if(source.lodSplats||source.extra?.lodTree?.length||source.splatEncoding?.lodOpacity===true)throw Error('The compact tour must use flat standard opacity.');
 if(typeof source.getNumSh==='function'&&source.getNumSh()!==asset.shDegree)throw Error('The decoded compact shading differs.');
 return true;
}
export function releaseCompressed(delivery){
 if(delivery){delivery.fileBytes=null;if(delivery.meshOptions)delivery.meshOptions.fileBytes=null;}
}

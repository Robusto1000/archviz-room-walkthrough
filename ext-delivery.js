// Byte-exact snapshot of accepted Spark2.4 ExtSplats; NO new quantization or LoD.
import {chunkURL} from './model-delivery.js';
const HASH=/^[a-f0-9]{64}$/i,NAMES=['ext0','ext1','sh1','sh2','sh3a','sh3b'];
const PINNED_SPARK='5ae86ab35d4ceb655db486dcc336299775bb314c280d7e5b39f64e4539f8e0e9';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function fail(message){throw Error(message);}
export async function prepareExactExtSplats(manifestURL,{expectedModel,manifestSha256,ExtSplats,onProgress=()=>{},signal,fetchImpl=fetch}={}){
  if(!HASH.test(manifestSha256??'')||typeof ExtSplats!=='function')fail('Pinned delivery identity and the accepted SparkExtSplats constructor are required.');
  const base=new URL(manifestURL,globalThis.location?.href??'http://127.0.0.1/');if(!['http:','https:'].includes(base.protocol))fail('A web model manifest is required.');
  const abort=new AbortController();if(signal?.aborted)throw signal.reason??Error('Model loading cancelled.');signal?.addEventListener('abort',()=>abort.abort(signal.reason),{once:true});
  const response=await fetchImpl(base,{signal:abort.signal,credentials:'omit',cache:'no-cache'});if(!response.ok)fail('The model manifest is unavailable.');const manifestBytes=await response.arrayBuffer();if(await digest(manifestBytes)!==manifestSha256.toLowerCase())fail('The model delivery manifest changed.');
  const manifest=JSON.parse(new TextDecoder().decode(manifestBytes)),source=manifest.original;
  if(manifest.schemaVersion!==1||manifest.encoding!=='spark-extsplats-gzip-chunks'||!expectedModel||source?.sha256!==expectedModel.sha256||source?.pointCount!==expectedModel.pointCount||source?.shDegree!==3||expectedModel.shDegree!==3||manifest.numSplats!==source.pointCount||manifest.storedSHDegree!==3||manifest.activeSHDegree!==3||manifest.additionalQuantization!==false||manifest.LOD!==false||manifest.allPointsInOriginalOrder!==true||manifest.byteOrder!=='little-endian'||manifest.spark?.vendorSha256!==PINNED_SPARK)fail('The hosted runtime model differs from the accepted preview.');
  if(new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]!==4)fail('This exact runtime asset requires a little-endian browser.');
  const capacity=manifest.paddedCapacity;if(!Number.isSafeInteger(capacity)||capacity<source.pointCount||capacity%2048||!Array.isArray(manifest.arrays)||manifest.arrays.length!==6||NAMES.some(name=>manifest.arrays.filter(a=>a.name===name).length!==1))fail('Invalid exact runtime source arrays.');
  let total=0,totalDecoded=0;
  for(const a of manifest.arrays){if(a.type!=='Uint32Array'||a.encoding!=='gzip-chunks'||a.elements!==capacity*4||a.bytes!==a.elements*4||!HASH.test(a.sha256??'')||!HASH.test(a.compressed?.sha256??'')||!Array.isArray(a.chunks)||!a.chunks.length||a.chunks.some(c=>!Number.isSafeInteger(c.bytes)||c.bytes<=0||c.bytes>24*1024*1024||!HASH.test(c.sha256??''))||a.chunks.reduce((n,c)=>n+c.bytes,0)!==a.compressed.bytes)fail('Invalid exact runtime array delivery.');a.chunks.forEach(c=>chunkURL(c.path,base));total+=a.compressed.bytes;totalDecoded+=a.bytes;}
  if(typeof DecompressionStream==='undefined')fail('Please use a current desktop browser with gzip stream support.');
  const arrays={};let loaded=0,decodedBytes=0;
  const progress=phase=>onProgress({phase,loaded,total,decodedBytes,totalDecoded});
  for(const name of NAMES){
    const a=manifest.arrays.find(a=>a.name===name),bytes=new Uint8Array(a.bytes);let index=0,received=0,offset=0;
    const compressed=new ReadableStream({async pull(controller){try{
      if(index===a.chunks.length){if(received!==a.compressed.bytes)fail('A model array download is incomplete.');controller.close();return;}
      const item=a.chunks[index],r=await fetchImpl(chunkURL(item.path,base),{signal:abort.signal,credentials:'omit',cache:'force-cache',mode:'cors'});if(!r.ok)fail('A model download part is unavailable.');const chunk=new Uint8Array(await r.arrayBuffer());if(chunk.length!==item.bytes||await digest(chunk)!==item.sha256)fail('A model download part failed its integrity check.');index++;received+=chunk.length;loaded+=chunk.length;progress('download');controller.enqueue(chunk);
    }catch(error){abort.abort(error);controller.error(error);}},cancel(reason){abort.abort(reason);}},{highWaterMark:0});
    const reader=compressed.pipeThrough(new DecompressionStream('gzip')).getReader();
    try{for(;;){const item=await reader.read();if(item.done)break;if(offset+item.value.length>bytes.length)fail('A model source array is too large.');bytes.set(item.value,offset);offset+=item.value.length;decodedBytes+=item.value.length;progress('decode');}
      if(offset!==bytes.length||index!==a.chunks.length||await digest(bytes)!==a.sha256)fail('The restored runtime model array differs.');arrays[name]=new Uint32Array(bytes.buffer);
    }catch(error){abort.abort(error);await reader.cancel(error).catch(()=>{});throw error;}
  }
  const extSplats=new ExtSplats({extArrays:[arrays.ext0,arrays.ext1],numSplats:manifest.numSplats,extra:{sh1:arrays.sh1,sh2:arrays.sh2,sh3a:arrays.sh3a,sh3b:arrays.sh3b},lod:false});
  if(extSplats.numSplats!==expectedModel.pointCount||extSplats.maxSplats!==capacity)fail('The accepted runtime constructor changed source point count/capacity.');
  const integrity={deliveryManifestSHA256Verified:true,allCompressedChunkSHA256Verified:true,allSixRestoredArraySHA256Verified:true,gzipCRCValidatedByPlatform:true,acceptedOriginalPLYSha256:source.sha256,pointCount:source.pointCount,storedSHDegree:3,activeSHDegree:3,additionalQuantization:false,LOD:false,paddedCapacity:capacity};progress('verified');
  return{meshOptions:{extSplats,lod:false},verified:Promise.resolve(integrity),manifest,integrity};
}

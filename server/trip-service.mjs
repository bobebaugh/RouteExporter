import {randomUUID} from 'node:crypto';
import {DOMParser} from '@xmldom/xmldom';
import {fromKml,MAX_BYTES} from '../app/kml.mjs';
import {authorize} from './access.mjs';
const result=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const validId=id=>/^[a-z0-9-]{1,80}$/.test(id||'');
export async function handle(request,storage){
 try {
  const method=request.method; const id=new URL(request.url).searchParams.get('id');
  if(!['GET','POST','PUT','DELETE'].includes(method))return result(405,{error:'Method not allowed.'});
  if(!await authorize(request,method))return result(403,{error:'Access denied.'});
  if(id&&!validId(id))return result(400,{error:'Invalid trip ID.'});
  if(method==='GET'){
   if(!id)return result(200,{trips:(await storage.list()).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))});
   const trip=await storage.read(id);return trip?result(200,{...trip,id}):result(404,{error:'This trip was deleted or does not exist. Import a local KML backup to restore it.'});
  }
  if((method==='PUT'||method==='DELETE')&&!id)return result(400,{error:'Trip ID required.'});
  if(method==='POST'&&id)return result(400,{error:'New trips receive a new ID.'});
  const bodyText=await request.text();if(Buffer.byteLength(bodyText)>MAX_BYTES+100000)return result(413,{error:'Trip exceeds the 4 MB limit.'});
  let body;try{body=JSON.parse(bodyText);}catch{return result(400,{error:'Invalid JSON request.'});}
  if(method!=='POST'&&(typeof body.revision!=='string'||!body.revision))return result(409,{error:'Reopen the trip before changing it.'});
  if(method==='DELETE'){const ok=await storage.delete(id,body.revision);return ok?result(200,{deleted:true}):result(409,{error:'The trip changed or was deleted. Reopen it before deleting.'});}
  let trip;try{trip=fromKml(body.kml,DOMParser);}catch(e){return result(400,{error:e.message});}
  if(!trip.segments.length)return result(400,{error:'Add at least one route before saving.'});
  if(method==='POST'&&body.id&&!validId(body.id))return result(400,{error:'Invalid trip ID.'});
  const key=id||body.id||randomUUID();const metadata={title:trip.title,updatedAt:new Date().toISOString(),legCount:trip.segments.length};
  const saved=await storage.write(key,body.kml,metadata,method==='POST'?null:body.revision);
  return saved?result(method==='POST'?201:200,saved):result(409,{error:'Someone changed or deleted this trip. Use Save As to preserve your version, or reopen it.'});
 }catch(e){console.error('Trip storage:',e.message);return result(503,{error:'Trip storage is unavailable. Your work is still here; Download KML to keep a copy.'});}
}

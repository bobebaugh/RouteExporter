import {createStorage} from '../../server/blob-storage.mjs';
import {handle} from '../../server/trip-service.mjs';
export default async function(request){
 try{return await handle(request,createStorage());}
 catch(e){console.error(e.message);return new Response(JSON.stringify({error:'Trip storage is not connected. Download KML to keep your work.'}),{status:503,headers:{'Content-Type':'application/json'}});}
}

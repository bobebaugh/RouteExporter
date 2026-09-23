import {getStore} from '@netlify/blobs';
import {storeName} from './deployment.mjs';
export function createStorage(){
 const name=process.env.TRIP_STORE || storeName;
 const store=getStore({name,consistency:'strong'});
 const key=id=>`trips/${id}.kml`;
 return {
  async list(){const {blobs}=await store.list({prefix:'trips/'});const rows=await Promise.all(blobs.map(async b=>{const r=await store.getMetadata(b.key);return !r||r.metadata?.deleted?null:{id:b.key.slice(6,-4),...r.metadata,revision:r.etag};}));return rows.filter(Boolean);},
  async read(id){const r=await store.getWithMetadata(key(id),{type:'text'});return !r||r.metadata?.deleted?null:{kml:r.data,...r.metadata,revision:r.etag};},
  async write(id,kml,metadata,revision){const r=await store.set(key(id),kml,{metadata,...(revision?{onlyIfMatch:revision}:{onlyIfNew:true})});return r.modified?{...metadata,id,revision:r.etag}:null;},
  // Conditional tombstone prevents a racing save from reviving or deleting a newer revision.
  async delete(id,revision){const r=await store.set(key(id),'',{metadata:{deleted:true},onlyIfMatch:revision});return r.modified;}
 };
}

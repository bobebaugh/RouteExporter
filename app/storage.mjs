// UI-facing storage contract. Replace this adapter to move providers.
const endpoint='/.netlify/functions/trips';
async function request(method,id,body){
 const response=await fetch(endpoint+(id?`?id=${encodeURIComponent(id)}`:''),{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({error:'Storage returned an invalid response.'}));
 if(!response.ok)throw new Error(result.error||'Trip storage is unavailable.');
 return result;
}
export const storage={list:()=>request('GET'),read:id=>request('GET',id),write:(id,kml,revision)=>request(id?'PUT':'POST',id,{kml,revision}),delete:(id,revision)=>request('DELETE',id,{revision})};

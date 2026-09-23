import {test} from 'node:test';import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {fromKml,toKml,validateTrip} from '../app/kml.mjs';
import {handle} from '../server/trip-service.mjs';
const sample={title:'Trip & <mountains>',notes:'A note\nSecond line',opacity:.45,mapStyle:'terrain',segments:[{title:'Day 1',note:'A & B',color:'#1684e8',sourceUrl:'https://www.google.com/maps/dir/?api=1&origin=A&destination=B',avoidHighways:true,points:[[35.123456789,-82.123456789],[35.234567891,-82.234567891,12.34]],stops:[{lat:35.123456789,lon:-82.123456789,name:'A, 123 Main Street'}],distance:1234.567,duration:789,startName:'A',endName:'B',shapingPointCount:2}]};
test('KML round trip preserves precision, links, metadata and every leg',()=>{
 const trip={...sample,segments:Array.from({length:14},(_,i)=>({...sample.segments[0],title:`Day ${i+1}`}))};
 assert.deepEqual(fromKml(toKml(trip),DOMParser),validateTrip(trip));
});
test('external KML imports lines and points with absent metadata left unknown',()=>{
 const trip=fromKml('<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Outside</name><Placemark><name>Route A</name><LineString><coordinates>-82,35,0 -81,36,0</coordinates></LineString></Placemark><Placemark><name>Stop</name><Point><coordinates>-82,35,0</coordinates></Point></Placemark></Document></kml>',DOMParser);
 assert.equal(trip.segments[0].duration,null);assert.equal(trip.segments[0].sourceUrl,'');assert.equal(trip.segments[0].stops[0].name,'Stop');
});
test('unsafe XML, bad geometry, malformed XML and unsupported versions fail',()=>{
 for(const xml of ['<!DOCTYPE kml><kml/>','<kml><Document></kml>','<kml><Document><Placemark><LineString><coordinates>999,999 0,0</coordinates></LineString></Placemark></Document></kml>',toKml(sample).replace('&quot;version&quot;:1','&quot;version&quot;:2')])assert.throws(()=>fromKml(xml,DOMParser));
 const trip=structuredClone(sample);trip.segments[0].sourceUrl='javascript:alert(1)';assert.equal(fromKml(toKml(trip),DOMParser).segments[0].sourceUrl,'');
});
function memory(){const rows=new Map();let serial=0;return {async list(){return [...rows].map(([id,v])=>({id,...v}));},async read(id){return rows.get(id)||null;},async write(id,kml,meta,revision){if(rows.has(id)?rows.get(id).revision!==revision:revision)return null;const value={kml,...meta,revision:String(++serial)};rows.set(id,value);return {id,...value};},async delete(id,revision){if(rows.get(id)?.revision!==revision)return false;rows.delete(id);return true;}};}
test('service create/read/rename/conflict/delete, with storage isolated from routing',async()=>{
 const store=memory();const req=(method,id,body)=>handle(new Request('https://app.test/api'+(id?'?id='+id:''),{method,...(body?{body:JSON.stringify(body)}:{})}),store);
 let r=await req('POST',null,{kml:toKml(sample)});assert.equal(r.status,201);const a=await r.json();
 r=await req('GET',a.id);assert.equal((await r.json()).kml,toKml(sample));
 r=await req('PUT',a.id,{kml:toKml({...sample,title:'Renamed'}),revision:a.revision});assert.equal(r.status,200);const b=await r.json();assert.equal(b.id,a.id);
 assert.equal((await req('PUT',a.id,{kml:toKml(sample),revision:a.revision})).status,409);
 assert.equal((await req('DELETE',a.id,{revision:a.revision})).status,409);
 assert.equal((await req('DELETE',a.id,{revision:b.revision})).status,200);
 assert.equal((await req('GET',a.id)).status,404);
 assert.equal((await req('PUT',a.id,{kml:toKml(sample),revision:b.revision})).status,409);
 assert.equal((await req('POST',null,{kml:'not XML'})).status,400);
});

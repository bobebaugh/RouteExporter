// Portable file format. No storage provider or routing service calls in this module.
export const MAX_BYTES = 4 * 1024 * 1024;
const NS = 'http://www.opengis.net/kml/2.2';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const children = (n, name) => Array.from(n.childNodes || []).filter(x => x.nodeType === 1 && x.localName === name);
const first = (n, name) => children(n,name)[0];
const text = (n,name) => first(n,name)?.textContent || '';
const all = (n,name) => Array.from(n.getElementsByTagNameNS('*',name));
const extra = (name,value) => `<ExtendedData><Data name="${name}"><value>${esc(JSON.stringify(value))}</value></Data></ExtendedData>`;
const metadata = (n,name) => {
 const data = children(first(n,'ExtendedData') || {},'Data').find(d=>d.getAttribute('name')===name);
 if (!data) return null;
 try { return JSON.parse(text(data,'value')); } catch { throw new Error('Invalid Route Exporter metadata.'); }
};
const coord = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
export const safeLink = value => {
 try { const u=new URL(value); return u.protocol==='https:' && ['google.com','www.google.com','maps.google.com','goo.gl','maps.app.goo.gl'].includes(u.hostname) ? u.href : ''; } catch { return ''; }
};
export function validateTrip(trip) {
 if (!trip || typeof trip.title!=='string' || !trip.title.trim() || trip.title.length>120 || !Array.isArray(trip.segments) || trip.segments.length>100) throw new Error('Invalid trip name or leg count (maximum 100).');
 let count=0;
 const segments=trip.segments.map((s,i)=>{
  if (!Array.isArray(s.points) || s.points.length<2 || !s.points.every(coord)) throw new Error(`Leg ${i+1} has invalid coordinates.`);
  count+=s.points.length;
  const stops=Array.isArray(s.stops)?s.stops:[];
  if (stops.length>2000 || stops.some(p=>!coord([p.lat,p.lon]) || typeof p.name!=='string')) throw new Error('Invalid waypoints.');
  return {title:String(s.title||`Leg ${i+1}`).slice(0,120),note:String(s.note||'').slice(0,3000),color:/^#[a-f\d]{6}$/i.test(s.color)?s.color:'#f05a28',sourceUrl:safeLink(s.sourceUrl),avoidHighways:s.avoidHighways===true,points:s.points,stops:stops.map(p=>({lat:p.lat,lon:p.lon,name:p.name.slice(0,1000)})),distance:Number.isFinite(s.distance)&&s.distance>=0?s.distance:null,duration:Number.isFinite(s.duration)&&s.duration>=0?s.duration:null,startName:String(s.startName||stops[0]?.name||'').slice(0,1000),endName:String(s.endName||stops.at(-1)?.name||'').slice(0,1000),shapingPointCount:Number.isInteger(s.shapingPointCount)&&s.shapingPointCount>=0?s.shapingPointCount:0};
 });
 if(count>250000) throw new Error('Trip has too many coordinates.');
 return {title:trip.title.trim(),notes:String(trip.notes||'').slice(0,3000),mapStyle:trip.mapStyle==='terrain'?'terrain':'standard',opacity:Number.isFinite(trip.opacity)?Math.max(.15,Math.min(.9,trip.opacity)):.5,segments};
}
export function toKml(input) {
 const trip=validateTrip(input);
 const {segments,...meta}=trip;
 const folders=segments.map(s=>{
  const {points,...leg}=s;
  const rgb=s.color.slice(1);const color=`80${rgb.slice(4)}${rgb.slice(2,4)}${rgb.slice(0,2)}`;
  return `<Folder><name>${esc(s.title)}</name>${extra('routeExporterLeg',leg)}<Placemark><name>${esc(s.title)}</name><description>${esc(s.note)}</description><Style><LineStyle><color>${color}</color><width>6</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${points.map(p=>`${p[1]},${p[0]},${p[2]??0}`).join(' ')}</coordinates></LineString></Placemark>${s.stops.map(p=>`<Placemark><name>${esc(p.name.split(',')[0])}</name><description>${esc(p.name)}</description><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`).join('')}</Folder>`;
 }).join('');
 return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="${NS}"><Document><name>${esc(trip.title)}</name><description>${esc(trip.notes)}</description>${extra('routeExporter',{version:1,...meta})}${folders}</Document></kml>`;
}
export function fromKml(xml, Parser=globalThis.DOMParser) {
 if(typeof xml!=='string'||new TextEncoder().encode(xml).length>MAX_BYTES) throw new Error('KML must be smaller than 4 MB.');
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('KML with DTD or entity declarations is not supported.');
 let doc;
 try { doc=new Parser({onError:()=>{throw new Error('Invalid XML');}}).parseFromString(xml,'application/xml'); } catch { throw new Error('Invalid KML XML.'); }
 if(!doc?.documentElement || doc.documentElement.localName!=='kml' || all(doc,'parsererror').length) throw new Error('Invalid KML XML.');
 const root=all(doc,'Document')[0]||doc.documentElement;
 const own=metadata(root,'routeExporter');
 const readLine=line=>text(line,'coordinates').trim().split(/\s+/).filter(Boolean).map(s=>{
  const parts=s.split(',').map(Number);if(parts.length<2||parts.length>3)throw new Error('Invalid KML coordinate.');
  return parts.length===3&&parts[2]!==0?[parts[1],parts[0],parts[2]]:[parts[1],parts[0]];
 });
 let segments;
 if(own){
  if(own.version!==1)throw new Error('This Route Exporter KML version is not supported.');
  segments=children(root,'Folder').map(f=>{
   const leg=metadata(f,'routeExporterLeg');const lines=all(f,'LineString');
   if(!leg||lines.length!==1)throw new Error('Incomplete saved leg.');
   return {...leg,points:readLine(lines[0])};
  });
 }else{
  const markers=all(root,'Placemark');
  const stops=markers.flatMap(p=>all(p,'Point').map(pt=>{const c=readLine(pt)[0]||[];return {lat:c[0],lon:c[1],name:text(p,'description')||text(p,'name')||'Waypoint'};}));
  segments=markers.flatMap(p=>all(p,'LineString').map(line=>{
   let style=first(p,'Style');const ref=text(p,'styleUrl');
   if(!style&&ref.startsWith('#'))style=all(root,'Style').find(s=>s.getAttribute('id')===ref.slice(1));
   const c=style?all(style,'color')[0]?.textContent:'';
   return {title:text(p,'name')||'Imported leg',note:text(p,'description'),points:readLine(line),stops:[],color:/^[\da-f]{8}$/i.test(c||'')?`#${c.slice(6,8)}${c.slice(4,6)}${c.slice(2,4)}`:'#f05a28'};
  }));
  if(!segments.length)throw new Error('This KML contains no route LineStrings.');
  segments[0].stops=stops;
 }
 return validateTrip({...own,title:text(root,'name')||own?.title||'Imported trip',notes:text(root,'description')||own?.notes||'',segments});
}

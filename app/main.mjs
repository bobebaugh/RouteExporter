import {storage} from './storage.mjs';
import {toKml,fromKml,MAX_BYTES} from './kml.mjs';
import {buildLeg,shortStopName,formatDuration,escapeXml} from './routing.mjs';
import {renderMapImage,emailParts} from './email.mjs';
import {normalizeFolder,validDate,rideDateFromTitle,buildTree,folderPaths,searchTrips} from './organize.mjs';
import {shrinkPhoto,pictureFrom} from './photo.mjs';
const $=id=>document.getElementById(id);
const palette=['#f05a28','#1684e8','#a946d1','#d99b00','#00a884','#e34878'];
// Suggested in Edit leg: the default palette plus strong colors that stand out on both map styles.
const legColors=[...palette,'#d7263d','#0b3d91','#1b1b1b','#2e7d32'];
const blank=()=>({title:'Untitled trip',notes:'',mapStyle:'standard',opacity:.5,folder:'',rideDate:'',segments:[]});
const formatDate=iso=>{const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});};
let savedRows=[];const openFolders=new Set();
let trip=blank(),saved=null,dirty=false,busy=false,selected=-1,dragged=null;
const map=L.map('map').setView([37,-82],5);
const tiles={standard:L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}),terrain:L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap, SRTM | OpenTopoMap (CC-BY-SA)',maxNativeZoom:17,maxZoom:19})};
let tile=tiles.standard.addTo(map);
const routes=L.featureGroup().addTo(map),markers=L.featureGroup().addTo(map);
let lines=[],cards=[];
const status=message=>{$('status').textContent=message||'';};
const discard=async()=>!dirty||await confirmAction('You have unsaved changes. Discard them? Download KML first if you want a backup.');
const markDirty=()=>{dirty=true;updateControls();};
const slug=name=>name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'trip';
const tripUrl=()=>`${location.origin}/?trip=${encodeURIComponent(saved.id)}&name=${slug(trip.title)}`;
function updateControls(){
 $('tripTitle').textContent=trip.title;
 $('saveState').textContent=dirty?'Unsaved changes':saved?'Saved':'Not saved';
 document.title=`${dirty?'* ':''}${trip.title} — Route Exporter`;
 $('tripNotes').textContent=trip.notes;$('notesDetails').hidden=!trip.notes;
 $('tripPlace').textContent=[trip.folder,trip.rideDate&&`Ride date ${formatDate(trip.rideDate)}`].filter(Boolean).join(' · ');$('tripPlace').hidden=!trip.folder&&!trip.rideDate;
 for(const id of ['saveTrip','saveAsTrip','downloadTrip','fitTrip','emailTrip'])$(id).disabled=busy||!trip.segments.length;
 $('shareTrip').disabled=busy||!saved||dirty;
 $('deleteTrip').disabled=busy||!saved;
 for(const id of ['newTrip','openTrip','tripMenu','importTrip','addButton','urlInput','avoidHighways','routeOpacity'])$(id).disabled=busy;
 cards.forEach((card,i)=>{card.draggable=!busy;for(const action of ['edit','remove'])card.querySelector(`[data-${action}]`).disabled=busy;card.querySelector('[data-up]').disabled=busy||i===0;card.querySelector('[data-down]').disabled=busy||i===cards.length-1;});
 document.body.classList.toggle('pending',busy);
}
async function task(fn){if(busy)return;busy=true;updateControls();try{await fn();}catch(e){status(e.message||'Something went wrong.');}finally{busy=false;updateControls();}}
function setStyle(style){map.removeLayer(tile);tile=tiles[style]||tiles.standard;tile.addTo(map);document.querySelectorAll('[data-map-style]').forEach(b=>{const on=b.dataset.mapStyle===style;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}
function selectLeg(index,scroll=false,zoom=false){
 selected=index;lines.forEach((pair,i)=>{const active=i===index;pair.line.setStyle({opacity:active?Math.min(.9,trip.opacity+.15):trip.opacity,weight:active?7:6});pair.outline.setStyle({opacity:active?.16:.08});cards[i]?.classList.toggle('selected',active);cards[i]?.setAttribute('aria-current',String(active));});
 if(scroll)cards[index]?.scrollIntoView({behavior:'smooth',block:'nearest'});
 if(zoom&&lines[index])map.fitBounds(lines[index].line.getBounds(),{padding:[40,40],maxZoom:13});
}
function render(fit=false){
 $('segmentList').replaceChildren();routes.clearLayers();markers.clearLayers();lines=[];cards=[];
 $('routeOpacity').value=String(Math.round(trip.opacity*100));$('opacityValue').textContent=`${Math.round(trip.opacity*100)}%`;setStyle(trip.mapStyle);
 const keys=new Set();
 trip.segments.forEach((s,i)=>{
  const outline=L.polyline(s.points,{color:'#172018',weight:9,opacity:.08,interactive:false}).addTo(routes);
  const line=L.polyline(s.points,{color:s.color,weight:6,opacity:trip.opacity}).addTo(routes);
  line.on('click',()=>selectLeg(i,true));line.bindTooltip(s.title,{sticky:true});lines.push({line,outline});
  for(const stop of s.stops){const key=`${stop.lat.toFixed(5)},${stop.lon.toFixed(5)},${stop.name}`;if(keys.has(key))continue;keys.add(key);L.circleMarker([stop.lat,stop.lon],{radius:4,weight:1,color:'#fffaf0',fillColor:s.color,fillOpacity:.85}).bindTooltip(shortStopName(stop.name),{permanent:true,direction:'top',className:'waypoint-label'}).addTo(markers);}
  const card=document.createElement('article');card.className='segment';card.tabIndex=0;card.draggable=true;card.setAttribute('aria-label',`${s.title}: ${s.startName||'route'} to ${s.endName||'destination'}`);
  const endpoints=s.startName||s.endName?`${shortStopName(s.startName)} → ${shortStopName(s.endName)}`:'';
  card.innerHTML=`<i class="swatch" style="background:${s.color}"></i><div><strong>${escapeXml(s.title)}</strong><span>${escapeXml(endpoints)}${endpoints?'<br>':''}${s.distance===null?'Distance unavailable':`${(s.distance/1609.344).toFixed(1)} miles`} · ${s.duration===null?'Time unavailable':formatDuration(s.duration)}</span>${s.note?`<br><span>${escapeXml(s.note)}</span>`:''}${s.sourceUrl?`<br><a class="source-link" href="${escapeXml(s.sourceUrl)}" target="_blank" rel="noopener">Open in Google Maps</a>`:''}<div class="leg-actions"><button data-edit>Edit</button><button data-up aria-label="Move ${escapeXml(s.title)} up">↑</button><button data-down aria-label="Move ${escapeXml(s.title)} down">↓</button><button data-remove>Remove</button></div></div>`;
  card.querySelector('[data-up]').disabled=busy||i===0;card.querySelector('[data-down]').disabled=busy||i===trip.segments.length-1;
  card.addEventListener('click',e=>{if(e.target.closest('a,button'))return;selectLeg(i,false,true);});
  card.addEventListener('keydown',e=>{if(e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectLeg(i,false,true);}});
  card.querySelector('[data-edit]').onclick=async()=>{if(busy)return;const value=await edit('Edit leg',s.title,s.note,true,s);if(!value||busy)return;if(value.sourceUrl!==s.sourceUrl||value.avoidHighways!==s.avoidHighways){if(!value.sourceUrl){status('Keep the existing link, or provide a Google Maps link to recalculate.');return;}await task(async()=>{status('Recalculating this leg with Google…');trip.segments[i]={...await buildLeg(value.sourceUrl,value.avoidHighways,value.name,value.color),note:value.notes,photo:value.photo,photoCaption:value.photoCaption};markDirty();render();status('Leg recalculated. Save to update the stored trip.');});}else{Object.assign(s,{title:value.name,note:value.notes,color:value.color,photo:value.photo,photoCaption:value.photoCaption});markDirty();render();}};
  card.querySelector('[data-remove]').onclick=async()=>{if(busy)return;if(!await confirmAction(`Remove ${s.title} from this trip?`))return;trip.segments.splice(i,1);selected=-1;markDirty();render();};
  const move=to=>{if(busy||to<0||to>=trip.segments.length)return;const [leg]=trip.segments.splice(i,1);trip.segments.splice(to,0,leg);selected=to;markDirty();render();};
  card.querySelector('[data-up]').onclick=()=>move(i-1);card.querySelector('[data-down]').onclick=()=>move(i+1);
  card.addEventListener('dragstart',e=>{if(busy){e.preventDefault();return;}dragged=i;e.dataTransfer.setData('text/plain',String(i));card.classList.add('dragging');});
  card.addEventListener('dragover',e=>{if(!busy&&dragged!==null)e.preventDefault();});
  card.addEventListener('drop',e=>{e.preventDefault();if(busy||dragged===null||dragged===i)return;const [leg]=trip.segments.splice(dragged,1);trip.segments.splice(i,0,leg);selected=i;dragged=null;markDirty();render();});
  card.addEventListener('dragend',()=>{dragged=null;card.classList.remove('dragging');});
  $('segmentList').append(card);cards.push(card);
 });
 if(!trip.segments.length){const p=document.createElement('p');p.className='empty';p.textContent='Paste a Google Maps link to add a route, or import a KML file.';$('segmentList').append(p);}
 const partial=trip.segments.some(s=>s.distance===null||s.duration===null);
 $('totalDistance').textContent=`${(trip.segments.reduce((n,s)=>n+(s.distance||0),0)/1609.344).toFixed(1)} mi`;
 $('totalDuration').textContent=formatDuration(trip.segments.reduce((n,s)=>n+(s.duration||0),0));
 $('segmentCount').textContent=`${trip.segments.length} ${trip.segments.length===1?"leg":"legs"}${partial?' · totals exclude unknown values':''}`;
 selectLeg(selected);updateControls();if(fit)fitAll();
}
function fitAll(){if(routes.getBounds().isValid())map.fitBounds(routes.getBounds(),{padding:[40,40]});else map.setView([37,-82],5);}
function adopt(next,record=null,changed=false){trip=next;saved=record;dirty=changed;selected=-1;render(true);$('avoidHighways').checked=trip.segments.length>0&&trip.segments.every(s=>s.avoidHighways);}
function confirmAction(message){
 const d=$('confirmDialog');$('confirmMessage').textContent=message;
 return new Promise(resolve=>{let accepted=false;$('confirmYes').onclick=()=>{accepted=true;d.close();};d.addEventListener('close',()=>resolve(accepted),{once:true});d.showModal();});
}
// place: {folder, rideDate} shows the trip-level Folder and Ride date fields (Save As, trip details).
function edit(heading,name,notes,showNotes=true,leg=null,place=null){
 $('legFields').hidden=!leg;$('editSource').value=leg?.sourceUrl||'';$('editAvoid').checked=!!leg?.avoidHighways;
 if(leg){editPhoto=leg.photo||null;showPhoto();$('editCaption').value=leg.photoCaption||'';}
 if(leg){$('editColor').value=String(leg.color).toLowerCase();$('colorSwatches').replaceChildren(...legColors.map(color=>{const b=document.createElement('button');b.type='button';b.className='swatch-choice';b.style.background=color;b.setAttribute('aria-label',`Use color ${color}`);b.onclick=()=>{$('editColor').value=color;};return b;}));}
 $('editHeading').textContent=heading;$('editName').value=name;$('editNotes').value=notes||'';$('notesLabel').hidden=!showNotes;
 $('tripFields').hidden=!place;
 // Until a date is chosen, the ride date follows a date written in the name ("2026 MAR 27 - …").
 let dateFollowsName=!!place&&!place.rideDate;
 if(place){$('editFolder').value=place.folder||'';$('editRideDate').value=place.rideDate||rideDateFromTitle(name);refreshFolderOptions();}
 $('editName').oninput=()=>{if(dateFollowsName)$('editRideDate').value=rideDateFromTitle($('editName').value);};
 $('editRideDate').oninput=()=>{dateFollowsName=false;};
 return new Promise(resolve=>{const d=$('editDialog');let value=null;$('editForm').onsubmit=e=>{e.preventDefault();const name=$('editName').value.trim();if(!name){$('editName').focus();return;}value={name,notes:$('editNotes').value,...(leg?{sourceUrl:$('editSource').value.trim(),avoidHighways:$('editAvoid').checked,color:$('editColor').value,photo:editPhoto,photoCaption:$('editCaption').value.trim()}:{}),...(place?{folder:normalizeFolder($('editFolder').value),rideDate:validDate($('editRideDate').value)}:{})};d.close();};d.addEventListener('close',()=>resolve(value),{once:true});d.showModal();$('editName').focus();});
}
// Leg photo in Edit leg: paste (Ctrl+V anywhere in the dialog), drop, or choose a file; shrunk in the browser.
let editPhoto=null;
const photoHint='Paste a picture (Ctrl+V) or drop one here';
function showPhoto(message=''){$('photoPreview').hidden=!editPhoto;$('photoPreview').src=editPhoto?.src||'';$('photoHint').textContent=message||photoHint;$('photoHint').hidden=!!editPhoto&&!message;$('photoRemove').hidden=!editPhoto;}
async function takePhoto(file){if(!file)return;showPhoto('Shrinking picture…');
 try{editPhoto=await shrinkPhoto(file);showPhoto();}catch(e){showPhoto(e.message);}}
$('editDialog').addEventListener('paste',e=>{if($('legFields').hidden)return;const file=pictureFrom(e.clipboardData);if(!file)return;e.preventDefault();takePhoto(file);});
$('photoBox').addEventListener('dragover',e=>{e.preventDefault();$('photoBox').classList.add('dragging');});
$('photoBox').addEventListener('dragleave',()=>$('photoBox').classList.remove('dragging'));
$('photoBox').addEventListener('drop',e=>{e.preventDefault();$('photoBox').classList.remove('dragging');takePhoto(pictureFrom(e.dataTransfer));});
$('photoChoose').onclick=()=>$('photoFile').click();
$('photoFile').onchange=()=>{const file=$('photoFile').files[0];$('photoFile').value='';takePhoto(file);};
$('photoRemove').onclick=()=>{editPhoto=null;showPhoto();};
function refreshFolderOptions(){
 const fill=()=>$('folderOptions').replaceChildren(...folderPaths(savedRows).map(path=>Object.assign(document.createElement('option'),{value:path})));
 fill();if(!savedRows.length)storage.list().then(({trips})=>{savedRows=trips;fill();}).catch(()=>{});
}
async function save(asNew=false){
 if(busy||!trip.segments.length)return;
 let candidate=trip;
 if(asNew||!saved){const value=await edit('Save As',trip.title==='Untitled trip'?'':trip.title,trip.notes,true,null,trip);if(!value)return;candidate={...trip,title:value.name,notes:value.notes,folder:value.folder,rideDate:value.rideDate};}
 else if(!await confirmAction(`Replace the shared version of “${trip.title}”? Anyone opening its link will see your changes.`))return;
 await task(async()=>{status('Saving…');const result=await storage.write(asNew?null:saved?.id,toKml(candidate),asNew?null:saved?.revision);trip=candidate;saved=result;dirty=false;savedRows=[];history.replaceState(null,'',tripUrl());render();status('Saved. Download KML to keep a personal backup.');});
}
async function load(id){await task(async()=>{status('Opening saved trip…');const record=await storage.read(id);const next=fromKml(record.kml);adopt(next,record);history.replaceState(null,'',tripUrl());$('openDialog').close();status('Opened saved KML. No Google routing request was needed.');});}
function tripRow(row,showFolder=false){
 const div=document.createElement('div');div.className='saved-row';const info=document.createElement('div');const title=document.createElement('strong');title.textContent=row.title;
 const small=document.createElement('small');
 small.textContent=[validDate(row.rideDate)&&formatDate(row.rideDate),`${row.legCount} ${row.legCount===1?'leg':'legs'}`,Number.isFinite(row.distanceMeters)&&`${Math.round(row.distanceMeters/1609.344)} mi`,Number.isFinite(row.durationSeconds)&&formatDuration(row.durationSeconds),showFolder&&(row.folder||'Not in a folder'),`saved ${new Date(row.updatedAt).toLocaleDateString()}`].filter(Boolean).join(' · ');
 info.append(title,small);const button=document.createElement('button');button.textContent='Open';button.setAttribute('aria-label',`Open ${row.title}`);button.onclick=async()=>{if(await discard())load(row.id);};div.append(info,button);return div;
}
function folderNode(node){
 const key=node.path.toLowerCase();const details=document.createElement('details');details.className='folder';details.open=openFolders.has(key);
 details.ontoggle=()=>{if(details.open)openFolders.add(key);else openFolders.delete(key);};
 const summary=document.createElement('summary');summary.textContent=`${node.name} (${node.count})`;const body=document.createElement('div');body.className='folder-body';
 body.append(...node.folders.map(folderNode),...node.trips.map(row=>tripRow(row)));details.append(summary,body);return details;
}
function renderList(){
 const container=$('savedList');container.replaceChildren();const query=$('tripSearch').value.trim();
 if(!savedRows.length){container.textContent='No saved trips yet. Start a new trip or import KML.';return;}
 if(query){const hits=searchTrips(savedRows,query);if(!hits.length)container.textContent='No saved trips match.';container.append(...hits.map(row=>tripRow(row,true)));return;}
 const tree=buildTree(savedRows);container.append(...tree.folders.map(folderNode));
 if(tree.folders.length&&tree.trips.length){const label=document.createElement('p');label.className='folder-label';label.textContent=`Not in a folder (${tree.trips.length})`;container.append(label);}
 container.append(...tree.trips.map(row=>tripRow(row)));
}
async function listTrips(){
 const container=$('savedList');container.textContent='Loading…';
 // Open the folders leading to the trip that's open now.
 normalizeFolder(trip.folder).split('/').filter(Boolean).forEach((_,i,parts)=>openFolders.add(parts.slice(0,i+1).join('/').toLowerCase()));
 try{const {trips}=await storage.list();savedRows=trips;renderList();}catch(e){container.textContent=e.message;}
}
$('tripSearch').oninput=renderList;
async function newTrip(){if(busy||!await discard())return;adopt(blank());history.replaceState(null,'','/');$('openDialog').close();status('Add routes, then Save As to name this trip.');}
$('newTrip').onclick=newTrip;$('dialogNew').onclick=newTrip;
$('openTrip').onclick=()=>{if(busy)return;$('openDialog').showModal();listTrips();};$('refreshTrips').onclick=listTrips;
$('saveTrip').onclick=()=>save();$('saveAsTrip').onclick=()=>save(true);
$('tripMenu').onclick=()=>$('menuDialog').showModal();
$('renameTrip').onclick=async()=>{$('menuDialog').close();const value=await edit('Trip details',trip.title,trip.notes,true,null,trip);if(!value)return;Object.assign(trip,{title:value.name,notes:value.notes,folder:value.folder,rideDate:value.rideDate});markDirty();render();status('Trip details updated locally. Save to update the shared trip.');};
$('deleteTrip').onclick=async()=>{if(!saved||busy)return;if(!await confirmAction(`Delete “${trip.title}” from online storage? This affects everyone. Download KML first if you need a backup.`))return;$('menuDialog').close();task(async()=>{await storage.delete(saved.id,saved.revision);saved=null;dirty=true;history.replaceState(null,'','/');status('Online trip deleted. Your open copy remains available to download or Save As.');});};
$('shareTrip').onclick=()=>task(async()=>{await navigator.clipboard.writeText(tripUrl());status('Trip link copied.');});
// Copy for email. The clipboard write must start inside the click, so it gets promises that resolve once
// the map is drawn (supported by current Chrome, Edge, Safari and Firefox). Older browsers fall back to
// copying a hidden selection, which works only while the click still counts as recent.
async function copyRich(parts){
 if(window.ClipboardItem&&navigator.clipboard?.write){
  try{await navigator.clipboard.write([new ClipboardItem({'text/html':parts.then(p=>new Blob([p.html],{type:'text/html'})),'text/plain':parts.then(p=>new Blob([p.text],{type:'text/plain'}))})]);return;}
  catch(e){console.warn('Rich clipboard write failed; trying selection copy.',e);}
 }
 const {html}=await parts;const holder=document.createElement('div');holder.contentEditable='true';holder.style.cssText='position:fixed;left:-10000px;top:0;width:720px';holder.innerHTML=html;document.body.append(holder);
 const range=document.createRange();range.selectNodeContents(holder);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
 const copied=document.execCommand('copy');selection.removeAllRanges();holder.remove();
 if(!copied)throw new Error('The browser blocked copying. Click Copy for email again.');
}
$('emailTrip').onclick=()=>{if(busy||!trip.segments.length)return;const snapshot=structuredClone(trip);const link=saved&&!dirty?tripUrl():null;
 const parts=renderMapImage(snapshot).then(image=>emailParts(snapshot,{image,link}));
 task(async()=>{status('Drawing the map for email…');await copyRich(parts);status(link?'Copied for email. Paste into a Gmail draft.':'Copied for email (no trip link until it is saved). Paste into a Gmail draft.');});};
$('downloadTrip').onclick=()=>{try{const url=URL.createObjectURL(new Blob([toKml(trip)],{type:'application/vnd.google-earth.kml+xml'}));const a=document.createElement('a');a.href=url;a.download=`${slug(trip.title)}.kml`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('KML downloaded with route lines, notes, and Google Maps links.');}catch(e){status(e.message);}};
$('importTrip').onclick=async()=>{if(!busy&&await discard())$('fileInput').click();};
$('fileInput').onchange=()=>{const file=$('fileInput').files[0];$('fileInput').value='';if(!file)return;task(async()=>{if(file.size>MAX_BYTES)throw new Error('KML must be smaller than 4 MB.');const next=fromKml(await file.text());adopt(next,null,true);history.replaceState(null,'','/');status('KML imported. Save As to add it to the online collection.');});};
$('fitTrip').onclick=fitAll;
$('routeOpacity').oninput=()=>{trip.opacity=Number($('routeOpacity').value)/100;$('opacityValue').textContent=`${$('routeOpacity').value}%`;selectLeg(selected);markDirty();};
document.querySelectorAll('[data-map-style]').forEach(b=>b.onclick=()=>{if(busy)return;trip.mapStyle=b.dataset.mapStyle;setStyle(trip.mapStyle);markDirty();});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('routeForm').onsubmit=e=>{e.preventDefault();task(async()=>{status('Calculating the new route with Google…');const i=trip.segments.length;const leg=await buildLeg($('urlInput').value.trim(),$('avoidHighways').checked,`Day ${i+1}`,palette[i%palette.length]);trip.segments.push(leg);dirty=true;selected=i;render(true);$('urlInput').value='';status('Route added. Save to keep its calculated line.');});};
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
// Compatibility for existing Copy Link URLs. Only these old links lack geometry.
async function openLegacy(value){await task(async()=>{
 const [format,payload]=value.split('.',2);const bytes=Uint8Array.from(atob(payload.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 const raw=format==='gz'?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
 if(format!=='gz'&&format!=='json')throw new Error('Unknown legacy link format.');const old=JSON.parse(raw);
 if(old.version!==2||!Array.isArray(old.segments)||old.segments.length>100)throw new Error('Invalid old trip link.');
 const next={...blank(),title:old.title||'Imported trip',notes:old.notes||'',segments:[]};
 for(const [i,s] of old.segments.entries()){status(`Converting old link: route ${i+1} of ${old.segments.length}…`);next.segments.push({...await buildLeg(s.sourceUrl,!!s.avoidHighways,s.title||`Day ${i+1}`,/^#[a-f\d]{6}$/i.test(s.color)?s.color:palette[i%palette.length]),note:s.note||''});}
 adopt(next,null,true);status('Old link converted. Save As to open it without recalculating next time.');
 });}
render();const id=new URLSearchParams(location.search).get('trip');const legacy=new URLSearchParams(location.hash.slice(1)).get('trip');
if(legacy)openLegacy(legacy);else if(id)load(id);else{$('openDialog').showModal();listTrips();}

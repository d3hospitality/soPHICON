// Adapted from D3 Sommni wineLENS OrbitGlobe. Geographic provenance: SOURCES.md.
const DEG = Math.PI / 180;
export const wrapLongitude = lon => ((lon + 540) % 360) - 180;
export const REGION_CENTERS = {'africa':[20,2], 'asia':[95,30], 'europe':[18,52], 'north-america':[-105,42], 'south-america':[-60,-18], 'oceania':[145,-25]};
export function project(lon, lat, camera, radius = 280, size = 720) {
  const delta = wrapLongitude(lon - camera.center[0]) * DEG, p = lat * DEG, c = camera.center[1] * DEG;
  return {x:size/2+radius*camera.zoom*Math.cos(p)*Math.sin(delta), y:size/2-radius*camera.zoom*(Math.cos(c)*Math.sin(p)-Math.sin(c)*Math.cos(p)*Math.cos(delta)), depth:Math.sin(c)*Math.sin(p)+Math.cos(c)*Math.cos(p)*Math.cos(delta)};
}
export function unproject(x, y, camera) {
  const dx=(x-360)/(280*camera.zoom),dy=(360-y)/(280*camera.zoom),r2=dx*dx+dy*dy;
  if(r2>1)return null;
  const z=Math.sqrt(1-r2),p=camera.center[1]*DEG;
  return [wrapLongitude(camera.center[0]+Math.atan2(dx,z*Math.cos(p)-dy*Math.sin(p))/DEG),Math.asin(Math.max(-1,Math.min(1,dy*Math.cos(p)+z*Math.sin(p))))/DEG];
}
export function insideRegion(point, polygons) {
  const ring=r=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [x,y]=r[i],[a,b]=r[j];if((y>point[1])!==(b>point[1])&&point[0]<(a-x)*(point[1]-y)/(b-y)+x)inside=!inside;}return inside;};
  return polygons.some(p=>ring(p[0])&&!p.slice(1).some(ring));
}
export function regionAt(point, regions) {
  return regions.find(r=>point[0]>=r.bounds[0]&&point[0]<=r.bounds[2]&&point[1]>=r.bounds[1]&&point[1]<=r.bounds[3]&&insideRegion(point,r.polygons)) || null;
}
export function fitCamera(polygons) {
  // Frame the largest land mass; unwrap around its first longitude at the dateline.
  const outer=polygons.reduce((best,p)=>p[0].length>best.length?p[0]:best,[]);
  if(!outer.length)return {center:[0,20],zoom:1};
  const xs=outer.map(p=>outer[0][0]+wrapLongitude(p[0]-outer[0][0])),ys=outer.map(p=>p[1]);
  const center=[wrapLongitude((Math.min(...xs)+Math.max(...xs))/2),(Math.min(...ys)+Math.max(...ys))/2];
  const extent=Math.max(...outer.map(p=>{const q=project(...p,{center,zoom:1},1,0);return Math.hypot(q.x,q.y);}));
  return {center,zoom:Math.min(28,Math.max(1,.85/Math.max(.025,extent)))};
}
const cache = new Map();
export function loadGeography(base = new URL('./', import.meta.url).href) {
  if(cache.has(base))return cache.get(base);
  const pending=(async()=>{
    const [response,image]=await Promise.all([fetch(new URL('countries.json',base)),new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('Country map unavailable'));i.src=new URL('world-ids.png',base).href;})]);
    if(!response.ok)throw Error('Country geography unavailable');
    const data=await response.json(),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const rgba=ctx.getImageData(0,0,image.width,image.height).data,ids=new Uint8Array(image.width*image.height);
    for(let i=0;i<ids.length;i++)ids[i]=rgba[i*4];
    const countryAt=(lon,lat)=>{const x=Math.max(0,Math.min(image.width-1,Math.round((wrapLongitude(lon)+180)/360*(image.width-1)))),y=Math.max(0,Math.min(image.height-1,Math.round((90-lat)/180*(image.height-1))));return ids[y*image.width+x];};
    const land=[],count=18000,golden=Math.PI*(3-Math.sqrt(5));
    for(let i=0;i<count;i++){const lat=Math.asin(1-2*(i+.5)/count)/DEG,lon=wrapLongitude(i*golden/DEG),id=countryAt(lon,lat);if(id)land.push({lon,lat,id});}
    const regionCache=new Map();
    return {...data,land,countryAt,async regions(code){if(!/^[A-Z]{3}$/.test(code))return [];if(!regionCache.has(code))regionCache.set(code,fetch(new URL(`regions/${code}.json`,base)).then(r=>{if(!r.ok)throw Error('State boundaries unavailable. Try again.');return r.json();}).catch(e=>{regionCache.delete(code);throw e;}));return regionCache.get(code);}};
  })().catch(e=>{cache.delete(base);throw e;});
  cache.set(base,pending);return pending;
}
export function drawGlobe(canvas, geo, camera, {country=null, regions=[], region=null, activity=[]}={}) {
  const size=720,R=280*camera.zoom;
  if(canvas.width!==size)canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,size,size);
  const pt=p=>project(...p,camera);
  const light=ctx.createRadialGradient(285,235,0,360,360,R);light.addColorStop(0,'#29281f');light.addColorStop(.75,'#141510');light.addColorStop(1,'#080a08');
  ctx.fillStyle=light;ctx.beginPath();ctx.arc(360,360,R,0,2*Math.PI);ctx.fill();
  const trace=(polys,color,width)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();for(const polygon of polys)for(const ring of polygon){let prev=null;for(const point of ring){const p=pt(point);if(p.depth>.001&&prev?.depth>.001&&Math.hypot(p.x-prev.x,p.y-prev.y)<R*.6)ctx.lineTo(p.x,p.y);else if(p.depth>.001)ctx.moveTo(p.x,p.y);prev=p;}}ctx.stroke();};
  const dot=(p,id)=>{const selected=id===country?.id;ctx.fillStyle=selected?`rgba(236,201,112,${.45+.5*p.depth})`:`rgba(155,172,150,${.2+.4*p.depth})`;ctx.beginPath();ctx.arc(p.x,p.y,selected?1.9:1.35,0,Math.PI*2);ctx.fill();};
  if(camera.zoom<1.6){for(const p of geo.land){const q=pt([p.lon,p.lat]);if(q.depth>.025)dot(q,p.id);}}
  else for(let y=8;y<720;y+=8)for(let x=8;x<720;x+=8){const p=unproject(x,y,camera);if(!p)continue;const id=geo.countryAt(...p);if(id)dot({x,y,depth:pt(p).depth},id);}
  for(const [code,polys] of Object.entries(geo.outlines))trace(polys,code===country?.code?'#e8ca81':'#77877565',code===country?.code?1.8:.65);
  if(camera.zoom>1.25)for(const r of regions)trace(r.polygons,r.id===region?.id?'#ffe5a0':'#a3b29b85',r.id===region?.id?2.8:.9);
  // Broad-region summaries only: these are not individual/user-location pins.
  for(const a of activity){const center=REGION_CENTERS[a.region];if(!center||!(a.thoughts>0))continue;const p=pt(center);if(p.depth<.05)continue;ctx.strokeStyle='#ead184';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,10+Math.min(12,Math.log2(a.thoughts+1)),0,2*Math.PI);ctx.stroke();ctx.fillStyle='#ffe9ae';ctx.beginPath();ctx.arc(p.x,p.y,3,0,2*Math.PI);ctx.fill();}
  ctx.strokeStyle='#a7a48166';ctx.lineWidth=1;ctx.beginPath();ctx.arc(360,360,R,0,2*Math.PI);ctx.stroke();
  canvas.dataset.longitude=camera.center[0].toFixed(3);canvas.dataset.zoom=camera.zoom.toFixed(3);canvas.dataset.country=country?.code||'';canvas.dataset.boundary=region?.id||'';
}
export function mountGlobe(host, {activity=[], onRegion=()=>{}}={}) {
  let disposed=false,frame=0,visible=false,geo=null,country=null,region=null,regions=[],selection=0,last=0,drag=null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),camera={center:[12,25],zoom:1};let spinning=!reduced.matches;
  host.innerHTML=`<div class="thought-orbit"><canvas width="720" height="720" tabindex="0" role="img" aria-label="Spinning 3D globe. Drag or use arrow keys to turn. Choose countries and states below."></canvas><div class="orbit-controls"><button type="button" data-orbit="spin"></button><button type="button" data-orbit="out" aria-label="Zoom out">−</button><button type="button" data-orbit="in" aria-label="Zoom in">+</button><button type="button" data-orbit="world">World</button></div><label>Country / territory<select data-orbit="country" disabled><option value="">Loading geography…</option></select></label><label>State / province / region<select data-orbit="region" disabled><option value="">Choose a country first</option></select></label><p class="orbit-status" role="status">Loading Sommni’s globe…</p><p class="orbit-help">Drag to turn · tap land to explore. Borders show geography; gold rings show broad-region activity.</p><div class="orbit-activity"></div><details><summary>Map credits</summary><p>Adapted from Sommni wineLENS. Natural Earth public-domain geography; simplified borders. No precise locations. <a href="${new URL('SOURCES.md',import.meta.url).href}" target="_blank" rel="noopener">Sources ↗</a></p></details></div>`;
  const canvas=host.querySelector('canvas'),spin=host.querySelector('[data-orbit="spin"]'),countrySelect=host.querySelector('[data-orbit="country"]'),regionSelect=host.querySelector('[data-orbit="region"]'),status=host.querySelector('.orbit-status');
  const listeners=[];const on=(el,type,fn,opts)=>{el.addEventListener(type,fn,opts);listeners.push(()=>el.removeEventListener(type,fn,opts));};
  const options=(select,rows,placeholder)=>{select.replaceChildren(new Option(placeholder,''),...rows.map(r=>new Option(r.name,r.code||r.id)));};
  function state(){spin.textContent=spinning?'Pause spin':'Spin globe';spin.setAttribute('aria-pressed',String(spinning));canvas.setAttribute('aria-label',`3D globe: ${country?.name||'World'}${region?', '+region.name:''}. Drag or use arrow keys to rotate.`);}
  function schedule(){if(!disposed&&visible&&!document.hidden&&!frame&&geo)frame=requestAnimationFrame(paint);}
  function paint(time){frame=0;if(disposed||!visible||document.hidden||!geo)return;if(spinning&&!drag&&last&&time-last<50){schedule();return;}if(spinning&&!drag&&last)camera.center[0]=wrapLongitude(camera.center[0]+Math.min(100,time-last)*.004);last=time;drawGlobe(canvas,geo,camera,{country,region,regions,activity});if(spinning&&!drag)schedule();}
  function redraw(){last=0;state();schedule();}
  function pause(){spinning=false;redraw();}
  function activityButtons(){const list=host.querySelector('.orbit-activity');list.replaceChildren();for(const row of activity){if(!REGION_CENTERS[row.region]||!(row.thoughts>0))continue;const b=document.createElement('button');b.type='button';b.textContent=`${row.region.replace(/-/g,' ')} · ${row.thoughts}`;b.onclick=()=>{camera.center=[...REGION_CENTERS[row.region]];camera.zoom=1.2;pause();onRegion(row.region);};list.append(b);}}
  async function selectCountry(code){const ticket=++selection;country=geo.countries.find(c=>c.code===code)||null;region=null;regions=[];countrySelect.value=code;regionSelect.disabled=true;options(regionSelect,[],country?'Loading boundaries…':'Choose a country first');if(!country){Object.assign(camera,{center:[12,25],zoom:1});status.textContent='World · explore countries and states';redraw();return;}Object.assign(camera,fitCamera(geo.outlines[code]||[]));pause();status.textContent=country.name+' · loading states and provinces';try{const rows=await geo.regions(code);if(disposed||ticket!==selection)return;regions=rows.sort((a,b)=>a.name.localeCompare(b.name));options(regionSelect,regions,regions.length?'All states / regions':'No subdivisions in this map');regionSelect.disabled=!regions.length;status.textContent=`${country.name} · ${regions.length} mapped subdivisions. Thought activity is shown at broad-region level.`;redraw();}catch(e){if(!disposed&&ticket===selection){options(regionSelect,[],'Boundaries unavailable');status.textContent=e.message;}}}
  function selectRegion(id){region=regions.find(r=>r.id===id)||null;regionSelect.value=id;Object.assign(camera,fitCamera(region?.polygons||geo.outlines[country.code]||[]));status.textContent=region?`${country.name} › ${region.name} · ${region.kind}. Geographic selection; no state-level post locations collected.`:country.name;pause();}
  on(countrySelect,'change',()=>void selectCountry(countrySelect.value));on(regionSelect,'change',()=>selectRegion(regionSelect.value));
  on(spin,'click',()=>{spinning=!spinning;redraw();});on(host.querySelector('[data-orbit="world"]'),'click',()=>{void selectCountry('');spinning=!reduced.matches;redraw();});
  for(const [name,factor] of [['in',1.4],['out',1/1.4]])on(host.querySelector(`[data-orbit="${name}"]`),'click',()=>{camera.zoom=Math.max(1,Math.min(28,camera.zoom*factor));pause();});
  on(canvas,'pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};spinning=false;canvas.setPointerCapture(e.pointerId);redraw();});
  on(canvas,'pointermove',e=>{if(!drag)return;const scale=180/(canvas.clientWidth*camera.zoom);camera.center[0]=wrapLongitude(camera.center[0]-(e.clientX-drag.x)*scale);camera.center[1]=Math.max(-85,Math.min(85,camera.center[1]+(e.clientY-drag.y)*scale));drag.moved ||= Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5;drag.x=e.clientX;drag.y=e.clientY;redraw();});
  on(canvas,'pointerup',e=>{const was=drag;drag=null;if(!was||was.moved||!geo)return;const rect=canvas.getBoundingClientRect(),p=unproject((e.clientX-rect.left)*720/rect.width,(e.clientY-rect.top)*720/rect.height,camera);if(!p)return;const c=geo.countries.find(c=>c.id===geo.countryAt(...p));if(!c)return;if(c.code!==country?.code)void selectCountry(c.code);else {const r=regionAt(p,regions);if(r)selectRegion(r.id);}});
  on(canvas,'pointercancel',()=>{drag=null;});
  on(canvas,'keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft'||e.key==='ArrowRight')camera.center[0]=wrapLongitude(camera.center[0]+(e.key==='ArrowLeft'?-8:8)/camera.zoom);else if(e.key==='ArrowUp'||e.key==='ArrowDown')camera.center[1]=Math.max(-85,Math.min(85,camera.center[1]+(e.key==='ArrowUp'?8:-8)/camera.zoom));else camera.zoom=Math.max(1,Math.min(28,camera.zoom*(e.key==='+'?1.3:1/1.3)));pause();});
  async function initialize(){if(geo)return;try{const data=await loadGeography();if(disposed)return;geo=data;options(countrySelect,[...geo.countries].sort((a,b)=>a.name.localeCompare(b.name)),'World');countrySelect.disabled=false;status.textContent='A shared world. Choose a country, then a state or region.';redraw();}catch(e){if(!disposed)status.textContent=e.message+' Reload to retry.';}}
  const observer=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible){void initialize();redraw();}else{cancelAnimationFrame(frame);frame=0;last=0;}},{threshold:.02});observer.observe(canvas);
  on(document,'visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else redraw();});on(reduced,'change',()=>{if(reduced.matches)spinning=false;redraw();});
  state();activityButtons();
  return {update(next){activity=next;activityButtons();redraw();},destroy(){disposed=true;selection++;cancelAnimationFrame(frame);observer.disconnect();listeners.forEach(off=>off());host.replaceChildren();}};
}

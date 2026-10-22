import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {project,unproject,regionAt,fitCamera} from '../public/aphorica/atlas/globe.mjs';
const read=name=>JSON.parse(fs.readFileSync(new URL('../public/aphorica/atlas/'+name,import.meta.url)));
test('orthographic selection round-trips across the dateline and rejects hidden hemisphere',()=>{
 for(const camera of [{center:[179,25],zoom:1},{center:[-74,42],zoom:5},{center:[12,70],zoom:2}])for(const delta of [-5,0,5]){
  const point=[camera.center[0]+delta,camera.center[1]+2];const q=project(...point,camera);const p=unproject(q.x,q.y,camera);
  assert.ok(Math.abs(((p[0]-point[0]+540)%360)-180)<1e-7);assert.ok(Math.abs(p[1]-point[1])<1e-7);
 }
 assert.equal(unproject(0,0,{center:[0,0],zoom:1}),null);
});
test('actual country/state data selects New York and frames California without wine data',()=>{
 const countries=read('countries.json');assert.equal(countries.countries.length,242);
 const states=read('regions/USA.json');assert.equal(regionAt([-74.006,40.713],states)?.name,'New York');
 const ca=states.find(s=>s.name==='California');const camera=fitCamera(ca.polygons);assert.ok(camera.zoom>3&&camera.zoom<=28);assert.ok(camera.center[0]<-114&&camera.center[0]>-125);
 assert.equal(states.some(s=>'pointCount' in s||'clusters' in s),false);
 for(const country of countries.countries){assert.ok(Array.isArray(read(`regions/${country.code}.json`)));}
});

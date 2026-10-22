import test from 'node:test';
import assert from 'node:assert/strict';
import { WONDER_MOMENTS, momentForDay, wonderDay, wonderMove, isVisiblePracticeMove } from '../src/wonder.mjs';

test('daily rotation uses calendar days through DST and cycles through every invitation',()=>{
 assert.equal(new Set(WONDER_MOMENTS.map(m=>m.id)).size,14);
 assert.equal(new Set(Array.from({length:14},(_,i)=>momentForDay('2026-10-22',i).id)).size,14);
 assert.equal(momentForDay('2026-11-05').id,momentForDay('2026-10-22').id);
 assert.equal(momentForDay('2026-11-02').id,momentForDay('2026-11-01',1).id);
 assert.equal(momentForDay('2026-10-22',-1).id,WONDER_MOMENTS.at(-1).id);
 assert.equal(wonderDay(new Date(2026,9,22,23,59)),'2026-10-22');
 for(const day of ['2026-02-30','2026-13-01','today','2026-1-1'])assert.throws(()=>momentForDay(day));
});
test('keeping on either surface has one identity; connecting a goal only changes the experiment',()=>{
 const moment=momentForDay('2026-10-22');
 const personal=wonderMove(moment,'2026-10-22',null,100);
 const connected=wonderMove(moment,'2026-10-22',{id:'goal1',status:'active'},200);
 assert.equal(personal.id,connected.id);assert.notEqual(personal.text,connected.text);
 assert.equal(personal.goalId,null);assert.equal(connected.goalId,'goal1');assert.equal(connected.quadrant,'Q2');
 assert.equal(wonderMove(moment,'2026-10-22',{id:'goal1',status:'done'}).goalId,null);
 assert.notEqual(personal.id,wonderMove(moment,'2026-10-23').id);
 assert.throws(()=>wonderMove({id:'invented'},'2026-10-22'));
});
test('personal Wonder steps are visible without exposing steps from finished goals',()=>{
 const m=wonderMove(WONDER_MOMENTS[0],'2026-10-22');
 assert.equal(isVisiblePracticeMove(m,[]),true);
 assert.equal(isVisiblePracticeMove({...m,origin:undefined},[]),false);
 assert.equal(isVisiblePracticeMove({...m,status:'done'},[]),false);
 assert.equal(isVisiblePracticeMove({...m,goalId:'g'},[{id:'g',status:'done'}]),false);
 assert.equal(isVisiblePracticeMove({...m,goalId:'g'},[{id:'g',status:'active'}]),true);
});

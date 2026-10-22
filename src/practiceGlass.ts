import { EvenAppBridge, EvenHubEvent, RebuildPageContainer, TextContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import { activeGoals, openMoves, goalById, setMoveStatus, syncPath, keepDailyMove, moveById, type Move, type Goal } from './path';
import { listHabits, getHabit, recordCheckIn, favoriteAsHabit, todayKey, type Habit } from './habits';
import { syncNow, markDirty, schedulePush } from './enkiSync';
import { authHeaders, isLinked } from './enkiAccount';
import { QUADRANTS, habitDays } from './daily-practice.js';

import { momentForDay, wonderMove, isVisiblePracticeMove, type WonderMoment } from './wonder.mjs';

type Mode='menu'|'goals'|'goal'|'steps'|'step'|'quadrants'|'habits'|'habit'|'proposal'|'note'|'wonder';
export class PracticeGlass {
 private mode:Mode='menu'; private quadrant=''; private busy=false; private planController:AbortController|null=null;
 private wonderOffset=0; private wonderDate=''; private wonderCurrent:WonderMoment|null=null;
 private actions:(()=>Promise<void>)[]=[]; private proposals:any[]=[]; private proposalIndex=0;
 constructor(private bridge:EvenAppBridge,private exit:()=>Promise<void>){}
 async open(wonder=false){await syncPath();await syncNow();if(wonder)await this.wonder();else await this.menu();}
 private async page(title:string,body:string,rows:[string,()=>Promise<void>][],mode:Mode,part=0){
  // Five conservative lines fit the body; longer goals and reasons remain readable.
  const lines:string[]=[];
  for(const paragraph of body.split('\n')){
   let line='';for(const word of paragraph.split(/\s+/)){if((line+' '+word).trim().length>40&&line){lines.push(line);line='';}line+=(line?' ':'')+word;}lines.push(line);
  }
  const pages=Math.max(1,Math.ceil(lines.length/5));
  const visible=lines.slice(part*5,part*5+5).join('\n');
  const choices=pages>1?[[`Read more (${part+1}/${pages})`,()=>this.page(title,body,rows,mode,(part+1)%pages)] as [string,()=>Promise<void>],...rows]:rows;
  this.mode=mode;this.actions=choices.map(r=>r[1]);
  const page=new RebuildPageContainer({containerTotalNum:3,textObject:[
   new TextContainerProperty({containerID:71,containerName:'day-title',xPosition:20,yPosition:8,width:536,height:30,content:title.slice(0,48),isEventCapture:0}),
   new TextContainerProperty({containerID:72,containerName:'day-body',xPosition:20,yPosition:44,width:536,height:142,content:visible,isEventCapture:0}),
  ],listObject:[new ListContainerProperty({containerID:73,containerName:'day-actions',xPosition:20,yPosition:192,width:536,height:90,isEventCapture:1,itemContainer:new ListItemContainerProperty({itemCount:choices.length,itemWidth:520,isItemSelectBorderEn:1,itemName:choices.map(r=>r[0].slice(0,55))})})]});
  if(!(await this.bridge.rebuildPageContainer(page)))throw Error('Could not display My day');
 }
 async menu(){await this.page('MY DAY','A little wonder. One real move.\nYour goals, priorities and quiet daily marks.',[
  ['A moment of wonder',()=>this.wonder()],['My goals',()=>this.goals()],['Today\'s steps',()=>this.steps()],['Four priorities',()=>this.quadrants()],['Daily marks',()=>this.habits()],['Back',this.exit]],'menu');}
 async wonder(){
  this.wonderDate=todayKey();this.wonderCurrent=momentForDay(this.wonderDate,this.wonderOffset);
  const m=this.wonderCurrent;
  await this.page('A MOMENT OF WONDER',m.question,[
   ['Read the quote',()=>this.wonderQuote()],['Try a small experiment',()=>this.wonderExperiment()],
   ['Another perspective',async()=>{this.wonderOffset++;await this.wonder();}],['Back to My day',()=>this.menu()]],'wonder');
 }
 private async wonderQuote(){const m=this.wonderCurrent!;await this.page(m.quote.philName.toUpperCase(),`"${m.quote.text}"\n${m.quote.source}`,[['Try the experiment',()=>this.wonderExperiment()],['Back',()=>this.wonder()]],'wonder');}
 private async wonderExperiment(goal:Goal|null=null){
  const m=this.wonderCurrent!,step=wonderMove(m,this.wonderDate,goal),kept=moveById(step.id);
  await this.page(`${m.minutes} MINUTES | TRY THIS`,`${goalById(kept?.goalId||goal?.id||null)?.title||'A moment for myself'}\n${kept?.text||step.text}`,[
   [kept?'View kept step':'Keep this step',async()=>{await syncPath();if(!moveById(step.id))await keepDailyMove(step);await this.step(moveById(step.id)!);}],
   ...(!kept&&activeGoals().length?[['Connect to a goal',()=>this.wonderGoal()] as [string,()=>Promise<void>]]:[]),
   ['Back',()=>this.wonder()]],'wonder');
 }
 private async wonderGoal(){await this.page('CONNECT THIS EXPERIMENT','Choose a goal, or keep a moment for yourself.',[
  ...activeGoals().map(g=>[g.title,()=>this.wonderExperiment(g)] as [string,()=>Promise<void>]),
  ['A moment for myself',()=>this.wonderExperiment()],['Back',()=>this.wonderExperiment()]],'wonder');}
 private async goals(){const goals=activeGoals();await this.page('MY GOALS','What would count as visible progress?\nAdd concrete goals at enkiridion.com/day.',[
  ...goals.map(g=>[g.title,()=>this.goal(g.id)] as [string,()=>Promise<void>]),['Back',()=>this.menu()]],'goals');}
 private async goal(id:string){const g=goalById(id);if(!g)return this.goals();await this.page('YOUR CONCRETE GOAL',`${g.title}\n${g.baseline||''}\n${g.targetDate?'By '+g.targetDate+' | ':''}${g.minutesPerDay||20} min/day`,[
  ['Build today\'s steps',()=>this.plan(g)],['View my steps',()=>this.steps('',id)],['Back',()=>this.goals()]],'goal');}
 private async plan(g:Goal){
  if(!(await isLinked()))return this.note('Link your free account at enkiridion.com/settings, then add a concrete goal at enkiridion.com/day.');
  await this.page('A SMALL NEXT STEP','Considering your goal and your time today...',[['Back',()=>this.goals()]],'note');
  const controller=new AbortController();this.planController=controller;let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},28000);
  try{
  const r=await fetch('https://sophicon-api.vercel.app/api/daily-plan',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify({goalId:g.id,date:todayKey()}),signal:controller.signal});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Could not build today\'s steps.');
  this.proposals=data.actions.map((x:any,i:number)=>({...x,id:`daily_${g.id}_${data.date}_${i}`,goalId:g.id,date:data.date}));this.proposalIndex=0;if(!controller.signal.aborted)await this.proposal();
  }catch(e){if(!controller.signal.aborted||timedOut)throw e;}finally{clearTimeout(timer);if(this.planController===controller)this.planController=null;}
 }
 private async proposal(){const p=this.proposals[this.proposalIndex];if(!p)return this.goals();await this.page(`POSSIBLE STEP ${this.proposalIndex+1}/${this.proposals.length}`,`${p.text}\n${p.minutes} min | ${QUADRANTS.find(q=>q.id===p.quadrant)?.label}\n${p.reason}`,[
  ['Keep this step',async()=>{await keepDailyMove(p);this.proposalIndex++;await this.proposal();}],['Next idea',async()=>{this.proposalIndex++;await this.proposal();}],['Back to goals',()=>this.goals()]],'proposal');}
 private async steps(quadrant='',goalId=''){
  this.quadrant=quadrant;const moves=openMoves().filter(m=>isVisiblePracticeMove(m,activeGoals())&&(!quadrant||(m.quadrant||'Q2')===quadrant)&&(!goalId||m.goalId===goalId));
  await this.page(quadrant?QUADRANTS.find(q=>q.id===quadrant)!.label.toUpperCase():'TODAY\'S STEPS',moves.length?'Choose one small action. Older open steps stay here until done or released.':'Nothing waiting here. Build a small step from one of your concrete goals.',[
   ...moves.slice(0,18).map(m=>[m.text,()=>this.step(m)] as [string,()=>Promise<void>]),['Back',()=>quadrant?this.quadrants():this.menu()]],'steps');
 }
 private async step(m:Move){await this.page('ONE REAL MOVE',`${goalById(m.goalId)?.title||'A moment for myself'}\n${m.text}\n${m.minutes?m.minutes+' min | ':''}${QUADRANTS.find(q=>q.id===(m.quadrant||'Q2'))?.label}`,[
  ['Mark done',async()=>{await setMoveStatus(m.id,'done');await this.steps(this.quadrant);}],
  ['Make a daily habit',async()=>{const h=await favoriteAsHabit({actionId:'habit_'+m.id,title:m.text,detail:'',source:'My goal',themes:[],tagHints:[],quote:null});await markDirty('habit',h.id);schedulePush();await this.habit(h.id);}],
  ['Change priority',()=>this.priority(m)],['Let go',async()=>{await setMoveStatus(m.id,'skipped');await this.steps(this.quadrant);}],['Back',()=>this.steps(this.quadrant)]],'step');}
 private async priority(m:Move){await this.page('CHOOSE PRIORITY',m.text,[...QUADRANTS.map(q=>[q.label,async()=>{await keepDailyMove({...m,quadrant:q.id});await this.step({...m,quadrant:q.id});}] as [string,()=>Promise<void>]),['Back',()=>this.step(m)]],'step');}
 private async quadrants(){await this.page('FOUR PRIORITIES','Important = moves your goal forward.\nUrgent = waiting has a real cost.\nYou do not need to fill every box.',[
  ...QUADRANTS.map(q=>[`${q.label} (${openMoves().filter(m=>(m.quadrant||'Q2')===q.id&&isVisiblePracticeMove(m,activeGoals())).length})`,()=>this.steps(q.id)] as [string,()=>Promise<void>]),['Back',()=>this.menu()]],'quadrants');}
 private async habits(){const all=await listHabits();await this.page('DAILY MARKS','Last 7 days, oldest to today.\n| done   . not done   _ today, open',[
  ...all.slice(0,18).map(h=>[`${habitDays(h).map(d=>d.mark).join('')}  ${h.title}`,()=>this.habit(h.id)] as [string,()=>Promise<void>]),['Back',()=>this.menu()]],'habits');}
 private async habit(id:string){const h=await getHabit(id);if(!h)return this.habits();const days=habitDays(h);const done=days[days.length-1]?.mark==='|';await this.page('QUIET PROOF',`${h.title}\n${days.map(d=>d.mark).join('  ')}\n| done   . not done   _ today, open`,[
  [done?'Undo today':'I did it today',async()=>{await recordCheckIn(id,done?'missed':'done',todayKey());await markDirty('habit',id);schedulePush();await this.habit(id);}],['Back',()=>this.habits()]],'habit');}
 private async note(text:string){await this.page('MY DAY',text,[['Back',()=>this.menu()]],'note');}
 async handle(event:EvenHubEvent){
  const type=event.sysEvent?.eventType??0;
  if(event.sysEvent&&type>=4)return false;
  if(this.busy&&this.planController&&event.sysEvent&&type===3){this.planController.abort();this.busy=false;await this.menu();return true;}
  if(this.busy)return true;
  if(event.sysEvent&&type===3){this.busy=true;try{if(this.mode==='menu')await this.exit();else await this.menu();}finally{this.busy=false;}return true;}
  if(event.listEvent&&(event.listEvent.eventType??0)===0){this.busy=true;try{await this.actions[event.listEvent.currentSelectItemIndex??0]?.();}catch(e){await this.note((e as Error).message);}finally{this.busy=false;}return true;}
  return true;
 }
}

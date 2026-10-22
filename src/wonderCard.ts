import { momentForDay, wonderDay, wonderMove } from './wonder.mjs';
import { activeGoals, moveById, keepDailyMove, onPathChange, syncPath } from './path';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function initWonderCard(){
 const today=document.querySelector('[data-panel="home"]');if(!today||document.getElementById('wonder-card'))return;
 const card=document.createElement('section');card.id='wonder-card';card.className='card wonder-card';card.setAttribute('aria-label','A moment of wonder');today.prepend(card);
 let day=wonderDay(),offset=0,goalId='',busy=false,message='';
 function render(){
  const moment=momentForDay(day,offset),goals=activeGoals(),goal=goals.find(g=>g.id===goalId)||null;
  const step=wonderMove(moment,day,goal),kept=moveById(step.id);
  card.innerHTML=`<div class="wonder-eyebrow">A MOMENT OF WONDER <span>${moment.minutes} min · ${escape(moment.theme)}</span></div>
   <p class="wonder-date">${offset===0?'Today’s invitation':'Another perspective'} · ${day}</p>
   <h2>${escape(moment.question)}</h2>
   <figure><blockquote>“${escape(moment.quote.text)}”</blockquote><figcaption>${escape(moment.quote.philName)} · ${escape(moment.quote.source)}</figcaption></figure>
   <div class="wonder-experiment"><strong>TRY THIS</strong><p>${escape(kept?.text||step.text)}</p>
   ${goals.length?`<label>Connect to a goal (optional)<select id="wonder-goal" ${busy||kept?'disabled':''}><option value="">A moment for myself</option>${goals.map(g=>`<option value="${escape(g.id)}" ${(kept?kept.goalId:goalId)===g.id?'selected':''}>${escape(g.title)}</option>`).join('')}</select></label>`:''}</div>
   <div class="wonder-actions"><button class="btn primary" id="wonder-keep" ${busy||kept?'disabled':''}>${busy?'Keeping…':kept?(kept.status==='done'?'Already completed':'Already kept'):'Keep this step'}</button><button class="btn" id="wonder-next" ${busy?'disabled':''}>Another perspective</button></div>
   <p class="wonder-hint">Kept steps appear on your glasses under My day → Today’s steps. Link your account to sync with the website.</p>
   <p class="wonder-message" role="status">${escape(message)}</p>`;
  card.querySelector<HTMLSelectElement>('#wonder-goal')?.addEventListener('change',e=>{goalId=(e.target as HTMLSelectElement).value;message='';render();});
  card.querySelector('#wonder-next')?.addEventListener('click',()=>{offset++;message='';render();});
  card.querySelector('#wonder-keep')?.addEventListener('click',async()=>{
   if(busy||kept)return;busy=true;message='';render();
   try{await syncPath();if(!moveById(step.id))await keepDailyMove(step);message='Kept in My day → Make time. Choose it on your glasses to make a habit.';}
   catch{message='Could not keep this step. Please try again.';}
   finally{busy=false;render();}
  });
 }
 onPathChange(render);render();
 const refresh=()=>{const next=wonderDay();if(next!==day){day=next;offset=0;message='';render();}};
 window.setInterval(refresh,60000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
}

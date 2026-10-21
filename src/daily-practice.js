/** Shared daily-practice rules. G2 keeps the identical module in src/. */
export const QUADRANTS = [
  { id: 'Q1', label: 'Do now', detail: 'Important + urgent' },
  { id: 'Q2', label: 'Make time', detail: 'Important, not urgent' },
  { id: 'Q3', label: 'Ask for help', detail: 'Urgent, less important' },
  { id: 'Q4', label: 'Let go', detail: 'Neither urgent nor important' },
];
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function shiftDay(day, n) { const d=new Date(day+'T12:00:00'); d.setDate(d.getDate()+n); return localDay(d); }
export function habitDays(habit, day=localDay(), count=7) {
  return Array.from({length:count},(_,i)=>{
    const date=shiftDay(day,i-count+1);
    const status=String((habit.history||[]).find(x=>x.date===date)?.status||'').toLowerCase();
    return {date,status,mark:status==='done'?'|':date===day&&!status?'_':'.'};
  });
}
export function checkHabit(habit, status, day=localDay(), now=Date.now()) {
  const history=[...(habit.history||[]).filter(x=>x.date!==day),{date:day,status,ts:now}].sort((a,b)=>a.date.localeCompare(b.date));
  const done=new Set(history.filter(x=>String(x.status).toLowerCase()==='done').map(x=>x.date));
  const today=localDay(new Date(now));
  let cursor=done.has(today)?today:shiftDay(today,-1),streak=0,bestStreak=0,run=0,prev=null;
  while(done.has(cursor)){streak++;cursor=shiftDay(cursor,-1);}
  for(const date of [...done].sort()){run=prev&&shiftDay(prev,1)===date?run+1:1;bestStreak=Math.max(bestStreak,run);prev=date;}
  return {...habit,history,streak,bestStreak,lastDoneDate:[...done].sort().at(-1)||null,lastCheckInDate:history.at(-1)?.date||null,updatedAt:now};
}
export function newHabit(id,title,goalId=null) {
 const now=Date.now();
 return {id,title,goalId,detail:'',source:'My goal',philName:'',philId:null,tradition:'',themes:[],tagHints:[],quote:null,createdAt:now,updatedAt:now,active:true,streak:0,bestStreak:0,lastDoneDate:null,lastCheckInDate:null,history:[]};
}

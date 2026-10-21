import { createClient } from '@supabase/supabase-js';
import { identify } from './_auth.js';
import { kv } from './_store.js';
import { dailyPlanPrompt } from '../prompts/daily-plan.js';
let client;
const db=()=>client||(client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}));
export function validActions(data,budget) {
 if(!Array.isArray(data?.actions)||data.actions.length<1||data.actions.length>3)return null;
 const result=[];
 for(const a of data.actions){
  if(typeof a.text!=='string'||a.text.trim().length<8||a.text.length>160||typeof a.reason!=='string'||a.reason.length>240||!['Q1','Q2','Q3','Q4'].includes(a.quadrant)||!Number.isInteger(a.minutes)||a.minutes<1||a.minutes>budget)return null;
  result.push({text:a.text.trim(),reason:a.reason.trim(),minutes:a.minutes,quadrant:a.quadrant});
 }
 if(result.reduce((n,a)=>n+a.minutes,0)>budget)return null;
 return result;
}
export default async function handler(req,res){
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 try{
  const identity=await identify(req);if(!identity?.userId)return res.status(401).json({error:'Sign in free to build your daily plan.'});
  const {goalId,date}=req.body||{};
  if(typeof goalId!=='string'||goalId.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date))||Math.abs(Date.parse(date)-Date.now())>2*864e5)return res.status(400).json({error:'Choose a goal and today’s date.'});
  const found=await db().from('device_sync').select('payload').eq('user_id',identity.userId).eq('entity_type','goal').eq('entity_id',goalId).is('deleted_at',null).maybeSingle();
  if(found.error)throw found.error;
  const goal=found.data?.payload;
  if(!goal||goal.status!=='active'||typeof goal.title!=='string')return res.status(404).json({error:'That active goal was not found in your account.'});
  const budget=Math.max(5,Math.min(120,Number(goal.minutesPerDay)||20));
  const key=`practice-plan:${identity.userId}:${goalId}:${date}:${goal.updatedAt||0}`;
  const cached=await kv.get(key);if(cached&&validActions(cached,budget))return res.status(200).json(cached);
  const day=new Date().toISOString().slice(0,10);
  const n=await kv.incr(`practice-plan-limit:${identity.userId}:${day}`);
  if(n>6)return res.status(429).json({error:'You’ve built six plans today. Keep working with your saved steps; new plans return tomorrow.'});
  const recentResult=await db().from('device_sync').select('payload').eq('user_id',identity.userId).eq('entity_type','path_move').is('deleted_at',null).order('updated_at',{ascending:false}).limit(100);
  if(recentResult.error)throw recentResult.error;
  const recent=(recentResult.data||[]).map(r=>r.payload).filter(m=>m?.goalId===goalId).slice(0,12).map(m=>({text:String(m.text||'').slice(0,160),status:m.status}));
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:dailyPlanPrompt({...goal,title:goal.title.slice(0,80),baseline:String(goal.baseline||'').slice(0,500),targetDate:String(goal.targetDate||'').slice(0,10),minutesPerDay:budget},date,recent)}],response_format:{type:'json_object'},max_tokens:700,temperature:0.4}),signal:AbortSignal.timeout(22000)});
  if(!response.ok)throw Error('provider_failed');
  const answer=await response.json();const actions=validActions(JSON.parse(answer.choices?.[0]?.message?.content||'{}'),budget);
  if(!actions)throw Error('invalid_plan');
  const result={goalId,date,actions};await kv.set(key,result,{ex:172800});
  return res.status(200).json(result);
 }catch{return res.status(503).json({error:'Your plan could not be built. Your goal is saved; please try again shortly.'});}
}

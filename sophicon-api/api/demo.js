import { resolvePersona, PERSONA_IDS } from './_persona.js';
import { requireEntitlement } from './_entitlements.js';
import { demoPrompt } from '../prompts/philosopher-demo.js';
export const SAMPLE_IDS = PERSONA_IDS;
const EMOTIONS = ['contemplation','teaching','compassion','resolve','wonder','serenity'];
export function validateSample(body) {
 if (!SAMPLE_IDS.includes(body?.philosopher)) return null;
 if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 800) return null;
 if (body.history !== undefined && !Array.isArray(body.history)) return null;
 const history=(body.history||[]).slice(-4).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1200)}));
 return {philosopher:body.philosopher,message:body.message.trim(),history};
}
export default async function handler(req,res){
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Device-Id');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 const input=validateSample(req.body);if(!input)return res.status(400).json({error:'invalid_sample'});
 const resolved=resolvePersona(input.philosopher);if(!resolved||!process.env.OPENAI_API_KEY)return res.status(503).json({error:'demo_unavailable'});
 try{
  // Public demo, signed-in web and paired glasses all consume the same speak quota.
  const identity = await requireEntitlement(req,res,'speak',{persona:resolved.id});
  if(!identity)return;
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:demoPrompt(resolved.persona)},...input.history,{role:'user',content:input.message}],response_format:{type:'json_object'},max_tokens:250,temperature:0.8}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('provider_failed');
  const payload=await response.json();const answer=JSON.parse(payload.choices?.[0]?.message?.content||'{}');
  if(typeof answer.text!=='string'||!answer.text.trim())throw new Error('empty_answer');
  return res.status(200).json({text:answer.text.slice(0,1800),emotion:EMOTIONS.includes(answer.emotion)?answer.emotion:'contemplation',remaining:identity.remaining,userMood:'neutral'});
 }catch{ return res.status(503).json({error:'demo_unavailable'}); }
}

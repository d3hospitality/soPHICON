/** Licensed synthetic character casting; never a claim of historical recordings. */
export const CAST = {
  socrates: ['Brian','Warm, thoughtful, gently questioning',0.96],
  plato: ['George','Warm, resonant and contemplative',0.94],
  aristotle: ['Bill','Precise, measured and clear',1.0],
  zeno_of_citium: ['Callum','Weathered, restrained and direct',0.94],
  seneca: ['Daniel','Polished, reflective and assured',0.96],
  epictetus: ['Liam','Direct, energetic and grounded',1.0],
  marcus_aurelius: ['Adam','Deep, deliberate and introspective',0.92],
  epicurus: ['Chris','Warm, relaxed and companionable',0.95],
  laozi: ['Eric','Calm, spacious and unhurried',0.9],
  zhuangzi: ['Charlie','Light, playful and curious',0.98],
  confucius: ['Roger','Courteous, steady and deliberate',0.94],
  gautama_buddha: ['Brian','Gentle, compassionate and still',0.9],
  nagarjuna: ['George','Quiet, exact and reflective',0.95],
  adi_shankaracharya: ['Liam','Clear, lyrical and assured',0.96],
  al_farabi: ['Daniel','Measured, harmonious and contemplative',0.95],
  avicenna: ['Chris','Fluent, warm and confidently curious',0.98],
  averroes: ['Bill','Sonorous, patient and authoritative',0.93],
};
export function castVoice(id, inventory, overrides={}) {
  const spec=CAST[id];if(!spec)throw Error(`No voice casting for ${id}`);
  const voices=inventory.voices||[];
  const voice=overrides[id]?voices.find(v=>v.voice_id===overrides[id]):voices.find(v=>v.category==='premade'&&(v.name===spec[0]||v.name.startsWith(spec[0]+' -')));
  if(!voice)throw Error(`Choose an available ElevenLabs voice for ${id} in ELEVENLABS_VOICE_MAP (preferred ${spec[0]}).`);
  return {voiceId:voice.voice_id,voiceName:voice.name,direction:spec[1],settings:{stability:0.65,similarity_boost:0.75,style:0.15,use_speaker_boost:true,speed:spec[2]}};
}

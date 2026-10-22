/** Curated experiments; the questions/actions are ours, never attributed as quotations.
 * Keep byte-identical with the web's lib/wonder.mjs. No AI call or account needed to browse.
 */
const QUOTES = {
  socrates: { philId:'socrates', philName:'Socrates', text:'The unexamined life is not worth living.', source:'The Apology' },
  marcus: { philId:'marcus_aurelius', philName:'Marcus Aurelius', text:'The impediment to action advances action. What stands in the way becomes the way.', source:'Meditations' },
  epictetus: { philId:'epictetus', philName:'Epictetus', text:'There are things which are within our power, and there are things which are beyond our power.', source:'Enchiridion (The Handbook)' },
  laozi: { philId:'laozi', philName:'Laozi', text:'The journey of a thousand miles begins with one step.', source:'Tao Te Ching' },
  confucius: { philId:'confucius', philName:'Confucius', text:'Learning without thought is labor lost; thought without learning is perilous.', source:'The Analects' },
  epicurus: { philId:'epicurus', philName:'Epicurus', text:'Pleasure is the beginning and the end of living happily.', source:'Letters and Sayings of Epicurus' },
};
export const WONDER_MOMENTS = [
  {id:'ordinary-miracle',title:'The ordinary, newly seen',theme:'Notice',quote:QUOTES.socrates,minutes:2,
   question:'What ordinary thing would you miss if it disappeared tomorrow?',
   action:'Look closely at one ordinary object for a minute. Write down three details you usually miss.',
   goalAction:'Notice one resource you already have for this goal. Write down three ways it could help.'},
  {id:'smallest-door',title:'The smallest door',theme:'Begin',quote:QUOTES.laozi,minutes:3,
   question:'What becomes possible when the first step is almost absurdly small?',
   action:'Choose something you have been postponing. Do only its first two minutes, then decide whether to continue.',
   goalAction:'Choose the smallest useful start toward this goal. Do it for two minutes; stopping there is allowed.'},
  {id:'other-story',title:'Another possible story',theme:'Reconsider',quote:QUOTES.socrates,minutes:3,
   question:'What else could be true about something you think you understand?',
   action:'Write one assumption about a recent situation. Add two other possible explanations without choosing a winner.',
   goalAction:'Write one assumption holding this goal back. Add two other possible explanations and one way to check.'},
  {id:'within-reach',title:'What is within reach?',theme:'Choose',quote:QUOTES.epictetus,minutes:3,
   question:'If you stopped trying to control the whole outcome, what could you do next?',
   action:'Split one concern into what you can choose and what you cannot. Take one tiny action from the first side.',
   goalAction:'List one part of this goal you can influence today and one you cannot. Act only on the first for two minutes.'},
  {id:'enough-for-now',title:'Enough, for this moment',theme:'Savor',quote:QUOTES.epicurus,minutes:2,
   question:'What is already good here, before anything else is added?',
   action:'Spend two minutes with a simple pleasure already available to you. Notice what makes it pleasant.',
   goalAction:'Name one small piece of progress you already made toward this goal. Pause to notice what it made possible.'},
  {id:'useful-obstacle',title:'A useful obstacle',theme:'Reframe',quote:QUOTES.marcus,minutes:4,
   question:'What could this difficulty teach you to practice?',
   action:'Name one small obstacle today. Write a skill it asks of you, then practice that skill for three minutes.',
   goalAction:'Name the nearest obstacle to this goal. Identify a skill it asks of you and practice it for three minutes.'},
  {id:'teach-one-thing',title:'Explain it simply',theme:'Understand',quote:QUOTES.confucius,minutes:4,
   question:'Which part of what you know becomes unclear when you try to explain it?',
   action:'Explain one thing you learned in three plain sentences. Circle the part you still cannot explain.',
   goalAction:'Explain the next step toward this goal in three plain sentences. Turn the unclear part into one question.'},
  {id:'hidden-work',title:'The work you did not see',theme:'Notice',quote:QUOTES.socrates,minutes:2,
   question:'How many unseen efforts make this ordinary moment possible?',
   action:'Choose something you use every day. Name three kinds of work that helped bring it to you.',
   goalAction:'Name three people or kinds of work that make this goal possible. Write one specific thing you could learn from them.'},
  {id:'leave-space',title:'Make a little room',theme:'Simplify',quote:QUOTES.epictetus,minutes:3,
   question:'What would become easier if one unnecessary demand disappeared?',
   action:'Choose one small, optional demand on your day. Decide to release it, shorten it or move it.',
   goalAction:'Identify one optional task that competes with this goal. Shorten it or move it to make a little room.'},
  {id:'beginner-eyes',title:'Borrow a beginner’s eyes',theme:'Reconsider',quote:QUOTES.confucius,minutes:3,
   question:'What would a curious beginner ask that you have stopped asking?',
   action:'Look at a familiar routine. Write one sincere beginner question about why it is done that way.',
   goalAction:'Imagine starting this goal for the first time. Write one basic question you have been too quick to skip.'},
  {id:'small-kindness',title:'A small act of care',theme:'Connect',quote:QUOTES.epicurus,minutes:3,
   question:'What small gesture could make someone’s ordinary day a little easier?',
   action:'Choose one person and one small helpful gesture. Make it specific, modest and free of expectation.',
   goalAction:'Name one person affected by this goal. Write one small way your next step could also help them.'},
  {id:'rough-first',title:'Let the first version be rough',theme:'Begin',quote:QUOTES.laozi,minutes:5,
   question:'What could exist in five minutes if it did not have to be impressive?',
   action:'Make a rough first version of something you have been considering: three lines, a sketch or a short outline.',
   goalAction:'Make a five-minute rough version of the next useful thing for this goal. Keep it small enough to finish.'},
  {id:'change-the-question',title:'Change the question',theme:'Reframe',quote:QUOTES.marcus,minutes:3,
   question:'What happens when “Why is this happening?” becomes “What can I try?”',
   action:'Rewrite one frustrating question as a small experiment. Name what you would notice if it helped.',
   goalAction:'Rewrite one frustration about this goal as a test you can try. Name the smallest sign that it helped.'},
  {id:'carry-one-thing',title:'Something worth carrying',theme:'Reflect',quote:QUOTES.socrates,minutes:3,
   question:'What did today teach you that you would like to remember tomorrow?',
   action:'Write one thing you noticed today and one small way you want it to affect tomorrow.',
   goalAction:'Write one thing this goal has taught you recently. Name one small change you want to make next time.'},
];
export function wonderDay(date=new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function momentForDay(day=wonderDay(),offset=0) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Use a calendar day');
  const ms=Date.parse(day+'T12:00:00Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==day)throw Error('Invalid calendar day');
  const n=Math.floor((ms-Date.parse('2026-10-22T12:00:00Z'))/86400000);
  const count=WONDER_MOMENTS.length,step=Number.isSafeInteger(offset)?offset:0;
  return WONDER_MOMENTS[((n+step)%count+count)%count];
}
export function wonderMove(moment,day,goal=null,now=Date.now()) {
  const canonical=WONDER_MOMENTS.find(m=>m.id===moment.id);
  if(!canonical)throw Error('Unknown wonder moment');
  momentForDay(day); // Validate the date used in the cross-device identity.
  const connected=goal?.status==='active'?goal:null;
  return {id:`wonder_${day}_${canonical.id}`,text:connected?canonical.goalAction:canonical.action,
    goalId:connected?.id||null,status:'open',createdAt:now,updatedAt:now,quadrant:'Q2',minutes:canonical.minutes,date:day,
    reason:canonical.question,philId:canonical.quote.philId,philName:canonical.quote.philName,origin:'wonder',wonderId:canonical.id};
}
export function isVisiblePracticeMove(move,goals) {
  return move.status==='open' && (goals.some(g=>g.id===move.goalId&&g.status==='active') || (move.origin==='wonder'&&!move.goalId));
}

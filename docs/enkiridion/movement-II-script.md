# ENKIRIDION — Movement II: THE APOLOGY
### Vertical-slice script · dialogue + choices + sprite cues

> **Purpose.** Prove the voice on the page before scaling to all five movements. This is one in-game week (Week 2). Timeline A = modern South Florida, played by day (the 1-3-5 loop, dilemmas). Timeline B = Athens 399 BC, entered by night through the Enkiridion. The week closes on the Sunday Examen.
>
> **Sprite cue format:** `[PHILOSOPHER : emotion]` names the portrait shown. A `→` marks a live swap mid-scene — the swap IS the storytelling. Emotions are drawn from the 23-sprite set in `sprites/`.
>
> **Choice format:** each choice is tagged with the tradition it scores toward `(STOIC / TAOIST / EPICUREAN / SOCRATIC / —)`. Choices never gate the story; they deepen bonds and unlock rarer quotes. Timeline B choices are offered and then overridden by history — that is the design.
>
> **Voice sources:** `personas.json` (Socrates: playful, ironic, self-deprecating, "chips away until the form emerges"; Epictetus: blunt, "some things are up to us"; Enki: ancient, water-and-stone, never says "process/journey/unpack").

---

## SCENE 2.0 — THRESHOLD · THE APSU (night)

*The hub. Black water. The device warms in Mario's hands. ENKI is a pale figure at the waterline.*

`[ENKI : contemplation]`

> **ENKI.** You came back. The current does that — it returns a thing to the same shore until the thing is ready to leave it.

> **ENKI.** Last night you watched an old man refuse to beg for his life. Tonight he refuses again, and you will want him to stop refusing. Hold that want. We shall look at it later.

`[ENKI : teaching]`

> **ENKI.** Lower the bucket slowly. Go down.

*Prompt: ▸ Descend into Athens.*

---

## SCENE 2.1 — ATHENS · THE COURT OF THE HELIAIA (Timeline B)

*Five hundred jurors on stone benches. Mario stands among them, unnumbered — JUROR #501. Dust, heat, the smell of bodies and olive oil. SOCRATES is small, barefoot, entirely at ease. He is enjoying himself. This is the wrong emotion for a man on trial, and everyone feels it.*

`[SOCRATES : teaching]`

> **SOCRATES.** Men of Athens. I do not know what you have felt, listening to my accusers — they spoke so well that I nearly forgot who I was. Almost none of it was true, but it was *beautifully* argued.

> **SOCRATES.** They warned you I am a clever speaker. You will discover in a moment that I am not. Unless a clever speaker is one who tells the truth — in which case, guilty.

*Ripple of laughter and anger both. MELETUS, young and certain, does not laugh.*

`[SOCRATES : teaching]` *(held — note that it does not move; he will hold `teaching` through this entire defense. The stillness is the performance.)*

> **SOCRATES.** They say I corrupt the young. Let me ask the man who accuses me. Meletus — who *improves* the young?

*Enki's voice, from the water, only Mario hears it:*

> **ENKI.** *(unseen)* He is not defending himself. Watch. He is teaching them, at his own trial, using himself as the lesson. This is either madness or the last free act of a free man.

**CHOICE — Juror #501, what do you do?**
- ▸ *"Ask him the harder question — make him prove he corrupts on purpose."* `(SOCRATIC)` → deepens **Socrates** bond. He glances toward you, amused someone in the crowd is actually thinking.
- ▸ *"Stay silent. Just witness."* `(TAOIST)` → deepens **Enki** bond. The still water in you.
- ▸ *"Object — this is a trial, not a classroom."* `(—)` → the guard tells you to sit. History does not care what you say.

*(All three converge. The scene proceeds either way — the point of #501 is that it must.)*

`[SOCRATES : conviction]` *(one flash — the only time his face hardens)*

> **SOCRATES.** I will not stop. Understand me. If you offered to release me on the condition that I stop asking my questions — I would answer: men of Athens, I love you, but I will obey the god rather than you, and as long as I breathe I will not cease.

> **SOCRATES.** An unexamined life is not worth living — not for me, and I suspect, though I would never presume, not for you.

`[SOCRATES : teaching]` *(returns; the hardness gone)*

*Transition — the light in Athens whitens and dissolves.*

---

## SCENE 2.2 — SOUTH FLORIDA · THE RESTAURANT, MORNING (Timeline A)

*March 2020. The tacky Italian dining room. Chairs still up on tables. A television murmurs the word "shutdown." Mario's phone won't stop. On the bar: a tiny plastic astronaut, face-up, watching the ceiling.*

**DAILY 1-3-5 — Draft your day.** *(The morning cockpit. The deck is thin today; the world is closing.)*
- **1 BIG:** *Call the linen supplier and beg for thirty more days.*
- **3 MEDIUM:** *Reheat yesterday's sauce · Count the register · Text the two servers still on payroll.*
- **5 SMALL:** *(mostly greyed out — there is nothing small left to do)*

*A dilemma fires. DEACON — the friend who curdled — calls. His voice is on speaker, too bright for the room.*

`[— : (no portrait; Deacon is a phone, a voice, the Ticker's herald)]`

> **DEACON.** Bro. Bro. Tell me you're watching this. Everything's on sale. This is the *reset*. You close that sad little kitchen, you put ten grand where I tell you, and this time next year you're not reheating anybody's sauce.

> **DEACON.** You always say it — "let's make it happen." So let's. Make. It. Happen.

**CHOICE — what do you tell Deacon?**
- ▸ *"My soul is not meant for this."* `(SOCRATIC)` → refuse the frame; deepens self-knowledge. Deacon laughs, wounded. Flags the **Crito arc** (Movement III payoff).
- ▸ *"Send me the details. I'll look."* `(—)` → you don't commit, but the door opens. (Non-canon drift — the game lets you flirt with the escape so refusing it later costs something.)
- ▸ *"I can't leave my dad in this."* `(STOIC — duty)` → deepens **father** bond and **Marcus** availability.

*Whichever — the call ends. The dining room is very quiet. The astronaut watches the ceiling.*

---

## SCENE 2.3 — SOUTH FLORIDA · THE DINING ROOM, 3 A.M. (Timeline A)

*The same room, hours turned. Mario sets tables for guests who will not come — folding napkins in a sealed restaurant, a private liturgy. This is SCARY DUDE, the night self, the one who does not flinch. He is sick — a low fever, health failing — and he does it anyway.*

`[EPICTETUS : contemplation]` *(the device has opened on its own; Epictetus has come uninvited)*

> **EPICTETUS.** Folding napkins for no one. I like you. I was a slave — I made beds for a man who broke my leg. Tell me, which of us is freer right now: you, or him?

**CHOICE:**
- ▸ *"Neither. We're both trapped."* `(—)` → `[EPICTETUS : stern]` "No. Wrong. Try again with your eyes open."
- ▸ *"Me. He needed me to obey. I don't need him to come."* `(STOIC)` → `[EPICTETUS : resolve]` bond up.
- ▸ *"I don't know. I'm too tired to be free."* `(SOCRATIC — honest ignorance)` → `[EPICTETUS : compassion]` "Good. That is the truest thing you've said. Now — rest is also within your control. The napkins will keep."

`[EPICTETUS : resolve]`

> **EPICTETUS.** Some things are up to us. Some are not. The plague is not up to us. The empty room is not up to us. The folding — the *how* you fold, whether you fold like a man burying something or a man preparing something — that is entirely, savagely up to you. It is the only thing that is. Guard it.

> **EPICTETUS.** You are not a waiter. A waiter is a role you are playing well in a bad play. The chains were never the job. Find the other handle.

*He fades. Mario keeps folding. The fever burns. The door at the back opens — his FATHER, who could not sleep.*

---

## SCENE 2.4 — THE LETTER (Timeline A) — *the anti-accuser beat*

*The father does not speak at first. He watches his son fold napkins in a dead room. He is holding a folded piece of paper. He sets it on the bar next to the astronaut and does not explain it. Then, quietly, he breaks — not loudly, a man crying the way men of his generation cry, which is to say almost silently, both hands flat on the bar.*

`[— : the father has no philosopher-portrait; he is real, and the screen holds on the letter, not a face]`

*Mario reads it after his father has gone back upstairs.*

> **THE LETTER.** *Mario. I know I gave you a sinking thing. I know you could have run and you stayed. I don't understand half of what you believe. But I have watched you fold these napkins for ghosts and I want you to know: I love you. I stand by you. No matter what. — Papá*

*Beat. The astronaut. The letter. The empty room.*

> **ENKI.** *(from the device, very quiet)* Write this down, in the place where you keep what cannot be taken. Socrates stood before five hundred men and no one stood behind him. You have one man behind you, in the dark, who does not understand you and stands there anyway.

`[ENKI : devotion]`

> **ENKI.** That is not a small thing. That is the whole difference. Remember it when the cup comes.

*A quiet collectible unlocks: a keepsake, not a quote — "The Letter" (permanent, un-loseable).*

---

## SCENE 2.5 — ATHENS · THE VERDICT (Timeline B) — *the thesis beat*

*Back in the Heliaia. The jurors file past the two urns, dropping bronze and clay ballots. Mario — #501 — holds his stone. The game gives him the vote.*

**CHOICE — Juror #501 casts:**
- ▸ ▸ ▸ **ACQUIT.** *(the only choice the player wants to make)*

*He drops it to acquit. The count is tallied on stone.*

**GUILTY — 280 to 221.**

*Mario's single stone was never counted. It could not have been. He watches the number settle.*

`[SOCRATES : teaching]` *(still, incredibly, teaching — even now)*

*And then — the beat the whole movement is built to earn — the portrait swaps. Not to grief. Not to fear. To:*

`[SOCRATES : teaching] → [SOCRATES : acceptance]`

> **SOCRATES.** Do not be angry on my behalf, young man in the back who voted for me — yes, I saw. Thank you. It changed nothing and it was the finest thing in this room.

> **SOCRATES.** A jury can be wrong and still be the jury. They have the power to kill me. They never had the power to make me a liar. Those are different powers. Most people, all their lives, confuse them.

`[SOCRATES : acceptance]` *(held)*

> **SOCRATES.** I am seventy. I was going to die of something. How lucky, to die of *this* — of not lying. Some men pay a fortune for a death that means so little.

*Enki, over the top, to Mario alone:*

> **ENKI.** There. You felt it. You wanted his face to fall. It did not fall. *That* is the lesson — not that he was brave, but that he was not performing bravery. He simply saw which things they could touch and which they could not, and he had spent his whole life keeping his valuables in the second place.

---

## SCENE 2.6 — SUNDAY EXAMEN · THE APSU (week close)

*The water. Enki. The week's two verdicts laid side by side — Socrates's 280-to-221, and Mario's own, still unwritten.*

`[ENKI : teaching]`

> **ENKI.** A week ends the way a day ends — because you close it, not because time obeys you. Before you close it, look. You watched a man be found guilty by a crowd and remain innocent to himself. You were folded over napkins in the dark, and a man who does not understand you stood behind you anyway.

> **ENKI.** So I ask you the juror's question, the one that is actually yours: **the crowd will find you guilty of something. What will it be — and will they be right?**

**EXAMEN CHOICE — Mario writes the first line of his own indictment:**
- ▸ *"Guilty of being too optimistic."* `(SOCRATIC)` → the charge he fears. Enki: "Is that a crime, or a diagnosis of health? We shall see, in the counting."
- ▸ *"Guilty of staying when I could have run."* `(STOIC)` → Enki: "That is not the charge they will bring. That is the charge you are proud of. Careful — pride and virtue share a coat."
- ▸ *"Not guilty. Not yet. Ask me in five years."* `(TAOIST)` → Enki: "The water's answer. It waits. Good."

**LEGENDARY QUOTE UNLOCKED —** *(the movement's reward; Marcus Aurelius, the anchor)*

> *"Here is a rule to remember in future, when anything tempts you to feel bitter: not 'This is misfortune,' but 'To bear this worthily is good fortune.'"*
> — Marcus Aurelius · **★ Legendary**

`[ENKI : peace]`

> **ENKI.** Close the week. Sleep. The ship has not yet come back from Delos. When it does — and it always does — we shall talk about waiting, and about your mother, and about the long dark you have not told me of yet.

> **ENKI.** I am older than your trouble. The trouble is new only to you. Rest.

*Fade. The restaurant light, in the corner of the hub, stays on.*

---

### Vertical-slice notes (for review)
- **Voice test result:** Socrates stays playful/ironic per `personas.json` even at the verdict — the `teaching → acceptance` hold (not a fall to `sorrow`) is what makes the thesis land. Epictetus is blunt and uses his own slavery. Enki never touches a therapy word.
- **The one non-negotiable sprite beat:** Scene 2.5, `teaching → acceptance`. If that swap doesn't move a player, the whole game's emotion-language thesis fails — so it's the first thing to prototype on real hardware.
- **Timeline-A restraint:** the father and the letter get **no philosopher portrait** on purpose — the reality is more powerful undramatized. Portraits are for the philosophers; life is rendered plainer.
- **What this proves:** the daily 1-3-5, a dilemma, two philosopher consults, the juror mechanic, the anti-accuser inversion, and the Examen all fit inside one readable week without tripping over each other.
- **Open:** does the `(—)` "drift" option (2.2 / 2.3) earn its keep, or does letting the player flirt with the escape dilute the refusal? Flagged for playtest.

// ═══════════════════════════════════════════════════════════════════
// api/types.jsdoc.js — Shared JSDoc type definitions for the
// sophicon-api codebase. No runtime code; import-free. Consumed
// by IDE tooling and documentation generators.
//
// Vercel's underscore-prefix convention doesn't apply here because
// this file contains no exports and no handler -- it's purely a
// type-documentation artifact.
// ═══════════════════════════════════════════════════════════════════

// ─── Core Philosopher Types ────────────────────────────────────────

/**
 * A philosopher persona definition, sent by the client for each
 * conversation. Drives the system prompt that keeps GPT-4o in
 * character throughout the session.
 *
 * @typedef {object} Persona
 * @property {string} name - Display name (e.g. "Marcus Aurelius")
 * @property {string} [tradition] - Philosophical tradition (e.g. "Stoic", "Existentialist")
 * @property {string} [persona] - Extended persona description
 * @property {string} [tone] - Tone directive (e.g. "warm but direct")
 * @property {string} [approach] - How the philosopher engages problems
 * @property {string} [speech_style] - Cadence, vocabulary, rhetorical habits
 * @property {string[]} [principles] - Core philosophical principles
 * @property {string[]} [emotions] - Canonical emotion states for sprite rendering
 * @property {string[]} [openings] - Conversation-opening lines
 */

/**
 * A single message in a conversation history array.
 *
 * @typedef {object} Message
 * @property {'user'|'assistant'|'system'} role - The speaker role
 * @property {string} content - Message text content
 */

// ─── User Profile ──────────────────────────────────────────────────

/**
 * User profile for personalizing philosopher replies. Sent with
 * each request so the philosopher has quiet awareness of who they
 * are speaking with. Never volunteered back to the user.
 *
 * @typedef {object} UserProfile
 * @property {string} [name] - User's display name
 * @property {string} [gender] - Gender enum: 'female' | 'male' | 'non_binary' | 'prefer_not_to_say'
 * @property {string} [pronouns] - Free-form pronoun string (legacy ER-G2 field)
 * @property {string} [role] - Life role or context (e.g. "graduate student")
 * @property {string} [currentFocus] - What the user is currently working through
 * @property {string[]} [challenges] - Recurring challenges (max 5)
 * @property {string[]} [values] - What the user cares about (max 5)
 * @property {'direct'|'socratic'|'mixed'} [adviceStyle] - Preferred advice delivery style
 * @property {'warm'|'challenging'|'mixed'} [tone] - Preferred reply tone
 * @property {'brief'|'detailed'|'mixed'} [replyLength] - Preferred reply length
 * @property {string[]} [guidelines] - Custom guidelines accumulated over time (max 10)
 * @property {string} [language] - ISO 639-1 language code (e.g. 'en', 'es')
 */

// ─── Journal & Analysis Types ──────────────────────────────────────

/**
 * A single conversation session from the user's Speak journal.
 * Sent to /api/problems, /api/actions, and /api/weekly-overview.
 *
 * @typedef {object} JournalSession
 * @property {string} date - ISO date string (YYYY-MM-DD)
 * @property {string} philName - Philosopher name in this session
 * @property {string} [tradition] - Philosopher's tradition
 * @property {Array<JournalExchange>} exchanges - All turns in the session
 */

/**
 * A single exchange turn within a journal session.
 *
 * @typedef {object} JournalExchange
 * @property {'user'|'assistant'} role - Who spoke
 * @property {string} content - Message text
 * @property {string} [userMood] - Detected user mood (user turns only)
 * @property {string} [emotion] - Philosopher emotion tag (assistant turns only)
 */

/**
 * A recurring problem theme extracted from the user's journal.
 * Returned by /api/problems and /api/weekly-overview.
 *
 * @typedef {object} Problem
 * @property {string} id - Stable kebab-case identifier
 * @property {string} title - 5-8 word descriptive title
 * @property {string} summary - One-sentence description
 * @property {string} [category] - Life area: Work | Love | Money | Health | Mind | Spirit | Other
 * @property {string} firstSeen - ISO date (YYYY-MM-DD) of first appearance
 * @property {string[]} philosophers - Names of philosophers who weighed in
 * @property {number} exchangeCount - Number of related user turns
 * @property {string[]} [moods] - Up to 3 observed userMood values
 * @property {Array<Action>} [actions] - Concrete action steps (weekly-overview only)
 * @property {'open'|'rolled-over'|'addressed'} [status] - Problem status
 * @property {number} [createdAt] - Epoch timestamp
 */

/**
 * A concrete action item derived from a philosopher conversation.
 * Returned by /api/actions and nested in weekly-overview Problems.
 *
 * @typedef {object} Action
 * @property {string} [id] - Stable kebab-case identifier (weekly-overview)
 * @property {string} title - Imperative action title (5-10 words)
 * @property {string} detail - 1-2 sentences combining WHY + HOW
 * @property {string} source - "Philosopher Name (Tradition)"
 * @property {string} [theme] - Short tag (actions endpoint)
 * @property {string} [quadrant] - Eisenhower quadrant: Q1 | Q2 | Q3 | Q4 (weekly-overview)
 * @property {string[]} [themes] - 1-3 emotion tags for quote matching (weekly-overview)
 * @property {string[]} [tagHints] - 1-3 topic hint tags (weekly-overview)
 * @property {boolean} [done] - Completion flag, client-managed
 */

// ─── Symposium Types ───────────────────────────────────────────────

/**
 * A single turn in a symposium debate transcript.
 *
 * @typedef {object} SymposiumTurn
 * @property {'philA'|'philB'|'moderator'} role - Which participant spoke
 * @property {string} philId - Best-effort philosopher ID
 * @property {string} philName - Philosopher's display name
 * @property {string} content - Turn text
 * @property {number} ts - Epoch timestamp
 */

// ─── Community Hub Types ───────────────────────────────────────────

/**
 * A community philosopher record stored in Vercel KV.
 *
 * @typedef {object} CommunityPhilosopher
 * @property {string} philId - Generated philosopher ID
 * @property {string} userId - Anonymous UUID from the client
 * @property {string} handle - Display handle (max 24 chars)
 * @property {string} tradition - Canonical tradition enum
 * @property {string} [personaTone] - Tone hint
 * @property {string} [personaApproach] - Approach hint
 * @property {string} [personaSpeechStyle] - Speech style hint
 * @property {'pending'|'generating'|'ready'|'failed'} spriteStatus - Sprite pipeline state
 * @property {string|null} [spriteError] - Error detail when spriteStatus is 'failed'
 * @property {number} createdAt - Epoch timestamp
 * @property {number} updatedAt - Epoch timestamp
 */

/**
 * A community quote record stored in Vercel KV.
 *
 * @typedef {object} CommunityQuote
 * @property {string} id - Generated quote ID
 * @property {string} userId - Submitter's anonymous UUID
 * @property {string} philId - Submitter's philosopher ID
 * @property {string} text - Quote text (max 240 chars)
 * @property {string} [source] - Optional attribution
 * @property {'published'|'rating'} status - Publication status
 * @property {number} likeCount - Total likes
 * @property {string} weekKey - ISO week key for weekly rankings
 * @property {number} createdAt - Epoch timestamp
 * @property {number} updatedAt - Epoch timestamp
 * @property {string|null} [emotion] - Classified emotion (post-classifier)
 * @property {string|null} [archetype] - Classified archetype (post-classifier)
 * @property {string|null} [blend] - Classified blend (post-classifier)
 * @property {number|null} [ratingScore] - Quality rating 1-10 (post-classifier)
 * @property {string[]} [tags] - Classified tags (post-classifier)
 */

// ─── Aphorica Classifier Types ─────────────────────────────────────

/**
 * Classification result from /api/aphorica/classify.
 *
 * @typedef {object} ClassifyResult
 * @property {string} emotion - One of the 23 canonical emotions
 * @property {string} archetype - One of the 12 archetype enums
 * @property {string} blend - One of the 20 blend enums
 * @property {number} ratingScore - Quality score 1-10
 * @property {string[]} tags - 0-5 single-word tags
 * @property {string|null} moderationFlag - null if clean; 'hate'|'self_harm'|'harassment'|'minors'|'spam'|'fake_deep'
 * @property {string|null} rejectReason - Human-readable rejection reason when flagged
 */

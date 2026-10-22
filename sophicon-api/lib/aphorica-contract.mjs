export const TITLE_LIMIT = 80;
export const BODY_LIMIT = 800;
export const REGIONS = [
  "africa",
  "asia",
  "europe",
  "north-america",
  "south-america",
  "oceania",
];
export const countText = (value) =>
  Array.from(String(value || "").normalize("NFC")).length;
export const cleanText = (value) =>
  String(value || "")
    .normalize("NFC")
    .trim();
export function validatePost(title, body) {
  if (
    countText(cleanText(title)) < 1 ||
    countText(cleanText(title)) > TITLE_LIMIT
  )
    throw Error("Use a title of 1–80 characters.");
  if (countText(cleanText(body)) < 1 || countText(cleanText(body)) > BODY_LIMIT)
    throw Error(
      "Use a post of 1–800 characters. Edit the transcript before publishing.",
    );
}
export function pairCode(value) {
  let raw = String(value || "").trim();
  try {
    const u = new URL(raw);
    raw = u.searchParams.get("pair") || u.searchParams.get("code") || raw;
  } catch {}
  return raw.replace(/[\s-]/g, "").toUpperCase();
}
export function publicPost(p, username, vote = 0) {
  return {
    id: p.id,
    user_id: p.user_id,
    title: p.title || "An early thought",
    body: p.text,
    legacy: !p.title,
    channel_id: p.channel_id,
    username: username || "member",
    created_at: p.created_at,
    edited_at: p.edited_at,
    revision: p.revision,
    upvotes: p.upvotes || 0,
    downvotes: p.downvotes || 0,
    vote,
  };
}

import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { identify } from "./_auth.js";
import { kv } from "./_store.js";
import { clientIp } from "./_policy.js";
import { pairCode } from "../lib/aphorica-contract.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { action, poll } = req.body || {};
    const code = pairCode(req.body?.code);
    if (action !== "status") {
      const key = `aph:pair:${clientIp(req.headers)}:${Math.floor(Date.now() / 3600000)}`;
      const n = await kv.incr(key);
      if (n === 1) await kv.expire(key, 3600);
      if (n > 30)
        return res
          .status(429)
          .json({ error: "Too many attempts. Try again later." });
    }
    const db = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
    if (action === "start") {
      const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
      const code = Array.from(
        { length: 8 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
      const secret = randomBytes(32).toString("base64url");
      const { data, error } = await db
        .from("aph_pair_requests")
        .insert({ code, poll_hash: hash(secret) })
        .select("expires_at")
        .single();
      if (error) throw error;
      return res.json({
        code,
        poll: secret,
        expires_at: data.expires_at,
        url: `https://enkiridion.com/link?pair=${code}`,
      });
    }
    if (!/^[A-Z2-9]{8}$/.test(code))
      return res
        .status(400)
        .json({ error: "Use the code or full link from the Even app." });
    if (action === "claim") {
      const who = await identify(req);
      if (!who || who.scope !== "user")
        return res.status(401).json({ error: "Sign in on the website first." });
      const { data, error } = await db
        .from("aph_pair_requests")
        .update({ user_id: who.userId, claimed_at: new Date().toISOString() })
        .eq("code", code)
        .is("user_id", null)
        .gt("expires_at", new Date().toISOString())
        .select("code")
        .maybeSingle();
      if (error) throw error;
      if (!data)
        return res
          .status(409)
          .json({
            error:
              "Code expired or already linked. Make a new code in the Even app.",
          });
      return res.json({ linked: true });
    }
    if (action === "status") {
      if (typeof poll !== "string" || poll.length < 40)
        return res.status(400).json({ error: "Invalid pairing request." });
      const { data: p, error } = await db
        .from("aph_pair_requests")
        .select("*")
        .eq("code", code)
        .eq("poll_hash", hash(poll))
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (error) throw error;
      if (!p) return res.json({ state: "expired" });
      if (!p.user_id) return res.json({ state: "pending" });
      const { data: profile } = await db
        .from("profiles")
        .select("handle")
        .eq("id", p.user_id)
        .maybeSingle();
      const issued = Math.floor(new Date(p.claimed_at).getTime() / 1000);
      if (!process.env.GLASSES_TOKEN_SECRET) throw Error("Pairing signing key unavailable");
      const token = await new SignJWT({ scope: "glasses" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(p.user_id)
        .setAudience("enki-glasses")
        .setJti(p.device_id)
        .setIssuedAt(issued)
        .setExpirationTime(issued + 180 * 86400)
        .sign(new TextEncoder().encode(process.env.GLASSES_TOKEN_SECRET));
      return res.json({
        state: "linked",
        token,
        handle: profile?.handle || "member",
        tier: "seeker",
      });
    }
    return res.status(400).json({ error: "Unknown pairing action." });
  } catch (e) {
    console.error("[social-pair]", e?.code || e?.name);
    return res
      .status(503)
      .json({ error: "Pairing is unavailable. Please try again." });
  }
}

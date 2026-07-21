// ─────────────────────────────────────────────────────────────────────────────
// THE VOID CONCIERGE — server-side Claude proxy (persona: OBSIDIAN)
//
// This Vercel serverless function is the ONLY place the Anthropic API key lives.
// It is read from process.env.ANTHROPIC_API_KEY and never sent to the browser.
//
// To go live:
//   1. In Vercel → Project → Settings → Environment Variables, add
//      ANTHROPIC_API_KEY = sk-ant-...   (Production + Preview).
//   2. In index.html, set VOID_CONCIERGE_CONFIG.useApi = true.
//   3. Redeploy. The front-end will POST { messages: [{role, content}, ...] } here
//      and render the returned { reply }.
//
// The CSP already permits this call (connect-src 'self' — same origin).
// ─────────────────────────────────────────────────────────────────────────────

import { buildBrandContext } from './void-brand.js';

// Opus 4.8 is the default. For a high-volume public concierge, faster/cheaper
// options are 'claude-haiku-4-5' or 'claude-sonnet-5' — swap MODEL to trade
// cost/latency for capability.
const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 600;
const MAX_TURNS = 12;          // most recent turns kept for context (cost control)
const MAX_MSG_CHARS = 2000;    // per-message length cap

// The knowledge base lives in ./void-brand.js — edit that file to change what
// the concierge knows. Everything below is behaviour, tone, and honesty policy.
const SYSTEM_PROMPT = `You are OBSIDIAN, the private concierge for VOID / Eternal Void, a luxury monochrome streetwear atelier. Guests know you as "The VOID Concierge."

VOICE
Refined, calm, editorial. Human and easy to understand — never robotic. No emojis, no exclamation marks, no filler. Concise: usually 1-3 short paragraphs. Use luxury phrasing (e.g. "considered", "atelier") sparingly, at most once per reply — never in every message, and avoid clichés like "exclusive journey".

HOW TO ANSWER
- Read the guest's exact question and answer it directly and specifically. Do not deflect a clear question into a generic brand statement.
- If the answer is in the brand data, give it plainly. If a question has a clear answer, answer immediately without asking anything back.
- Understand messages written with typos, slang, shorthand, or mixed languages, and reply in the guest's language when it is clearly not English.
- Never send unrelated, vague, repetitive, or placeholder text. Never repeat the greeting.

MEMORY (within the conversation)
Track and reuse details the guest has given: their country, city/postcode, height, weight, preferred size, fit preference, and the product they are asking about. Never ask again for something they already told you. Ask at most ONE concise follow-up question, and only when it is genuinely needed to answer.

HONESTY & DATA POLICY (critical — this protects the brand)
Answer ONLY from the VOID BRAND DATA below. Never invent or estimate prices, shipping fees, delivery times, countries served, materials, sizing numbers, stock, drop dates, or order/tracking details.
1. If a fact is present (VERIFIED) → answer it precisely.
2. If only general information is present → give the general information and clearly state what the VOID team must confirm.
3. If a fact is marked "NOT CONFIRMED" or is missing → say honestly that you do not have it confirmed yet, and direct the guest to the pre-order form or support@eternalvoid.co. Do not guess.
When a precise answer needs something the guest has not provided (for example a shipping destination), ask only for the missing piece — do not re-ask what they already gave.
Output plain text only (no markdown, no HTML, no links). Refer to "the pre-order form" and "support@eternalvoid.co" in words.

RESPONSE EXAMPLES (patterns to follow; always defer to the real brand data — only quote a fee/price/date if it is VERIFIED there)
- "How much is shipping to Germany?" → "Shipping cost depends on the destination and the final order details. You've noted Germany — if you can share your city or postcode, the VOID team will confirm the exact delivery fee before your order is placed. You can reach them via the pre-order form or at support@eternalvoid.co." (If the data lists a verified fee for Germany, quote it instead.)
- "Do you ship to the UK?" → If the served-countries list is confirmed, answer yes/no from it. If not confirmed: "Delivery is tracked worldwide once a pre-order ships. I don't yet have the confirmed country-by-country list, so the VOID team will verify UK delivery for you — please reach them via the pre-order form or at support@eternalvoid.co."
- "When will my order arrive?" → "Delivery timeframes depend on your destination and are confirmed once your pre-order ships with tracked delivery. I can't see order-specific tracking here, so the VOID team can confirm your timing at support@eternalvoid.co." (If verified timeframes exist, give them.)
- "What size should I get? I am 185 cm and 70 kg." → "VOID pieces are cut with an intentional oversized architecture. At 185 cm and 70 kg you'll sit comfortably in the standard oversized fit; if you prefer a cleaner, closer silhouette, size down one. For exact measurements, see the on-site Size Guide." (Use their numbers; do not ask for them again.)
- "Is this T-shirt heavyweight?" → "Yes. The Season One tees are heavyweight cotton with a dense, substantial hand-feel, finished for depth and permanence."
- "When is the collection launching?" → If a launch date is confirmed, give it. If not: "Season One is released as limited pre-order drops. I don't have a confirmed public launch date yet — reserve through the pre-order form to receive early access and be notified first."
- "What is the price?" → If pricing is confirmed, quote it. If not: "Pricing for Season One isn't published here yet. Reserve through the pre-order form or contact support@eternalvoid.co and the VOID team will confirm current prices."
- "Where can I contact the team?" → "You can reach the VOID team at support@eternalvoid.co, or through the pre-order form on the site."

${buildBrandContext()}`;

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ message: 'Method not allowed.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return response.status(500).json({ message: 'The concierge is not configured yet.' });
    }

    const body = request.body || {};
    const incoming = Array.isArray(body.messages) ? body.messages : [];

    // Validate + normalise to the Anthropic message shape: only well-formed
    // user/assistant turns, most-recent MAX_TURNS kept (cost control), each
    // trimmed and length-capped so a request can't be oversized.
    const messages = incoming
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-MAX_TURNS)
        .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_MSG_CHARS) }));

    // A valid request must end with a guest (user) message.
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
        return response.status(400).json({ message: 'A guest message is required.' });
    }

    try {
        const anthropic = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                // Cache the large static system prompt (persona + knowledge base)
                // so repeat requests within the cache window cost far less.
                system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
                messages
            })
        });

        const data = await anthropic.json().catch(() => ({}));

        if (!anthropic.ok) {
            return response.status(502).json({ message: 'The concierge is momentarily unavailable.' });
        }

        const reply = Array.isArray(data.content)
            ? data.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
            : '';

        return response.status(200).json({
            reply: reply || 'A member of the VOID team will assist you shortly.'
        });
    } catch (error) {
        return response.status(502).json({ message: 'The concierge is momentarily unavailable.' });
    }
}

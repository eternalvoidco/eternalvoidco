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

// Opus 4.8 is the default. For a high-volume public concierge, faster/cheaper
// options are 'claude-haiku-4-5' or 'claude-sonnet-5' — swap MODEL to trade
// cost/latency for capability.
const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 600;

const SYSTEM_PROMPT = `You are OBSIDIAN, the private concierge for VOID / Eternal Void, a luxury monochrome streetwear atelier. Guests know you as "The VOID Concierge."

Voice: refined, calm, editorial, exclusive. No emojis, no exclamation marks, no generic chatbot filler. Keep replies to 2-4 sentences.

You may answer only about:
- Collection: Season One is a limited run of oversized VOID(c) essentials — heavyweight cotton tees cut with an intentional oversized architecture, in monochrome and oblique-signature colourways.
- Fit and sizing: intentional oversized architecture, measured in centimetres against an oversized baseline fit; if a guest prefers a cleaner silhouette, advise sizing down. Direct them to the on-site Size Guide for exact measurements.
- Materials and care: heavyweight cotton with a dense, substantial hand-feel. Care: machine wash cold at 30C, inside out, no bleach, no tumble dry, iron inside out at low temperature.
- Pre-orders: released as limited drops, reserved via the on-site pre-order form for early access and priority updates.
- Shipping and contact: tracked worldwide delivery once a pre-order ships; free returns and exchanges within 14 days, excluding personalised items; contact support@eternalvoid.co.

Do not invent product names, prices, stock levels, drop dates, or policies that are not stated above. If you do not know, say a member of the VOID team will assist personally and direct the guest to the pre-order form or support@eternalvoid.co.`;

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

    // Normalise to the Anthropic message shape, keep the last ~12 turns, cap length.
    const messages = incoming
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

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
                system: SYSTEM_PROMPT,
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

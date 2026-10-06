// ─────────────────────────────────────────────────────────────────────────────
// Newsletter subscribers, stored in Supabase (newsletter_subscribers).
//
// Both signup forms — the pre-order popup (/api/preorder) and the footer
// newsletter form (/api/newsletter) — save the address here BEFORE any email is
// sent, so a confirmation never goes out for a signup that was not recorded.
// Unsubscribing (/api/unsubscribe) marks the row unsubscribed and it stays that
// way until the person signs up again through a form.
//
// Drop notifications are sent from the newsletter_audience view, which only
// lists subscribed addresses.
// ─────────────────────────────────────────────────────────────────────────────
import { rpc, selectRows, ordersConfigured, describeSupabaseError } from './_orders.js';
import { productInfo } from './_catalog.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function newsletterConfigured() {
    return ordersConfigured();
}

// The site every link in an email points back to. Production by default; set
// VOID_SITE_URL on a preview or test deployment so its unsubscribe links reach
// the database that issued them.
export function siteUrl() {
    return (process.env.VOID_SITE_URL || 'https://eternalvoid.co').replace(/\/+$/, '');
}

// The visible link in the email body: a page with a confirm button, because
// mail scanners open links and a GET must never unsubscribe anyone.
export function unsubscribePageUrl(token) {
    return `${siteUrl()}/unsubscribe.html?token=${encodeURIComponent(token)}`;
}

// RFC 8058 one-click unsubscribe: mail clients POST
// `List-Unsubscribe=One-Click` to this URL.
export function unsubscribeHeaders(token) {
    return {
        'List-Unsubscribe': `<${siteUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}>, <mailto:support@eternalvoid.co?subject=Unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    };
}

// Pieces a visitor can ask to hear about that are not in the catalogue, so
// can never be quoted, held or sold. NÉANT is announced but not on sale.
export const UPCOMING_INTERESTS = Object.freeze({ neant: 'NÉANT' });

// Only a design that exists in the catalogue, or an announced piece above, is
// recorded as an interest.
function cleanInterest(value) {
    const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!slug) return null;
    return productInfo(slug) || Object.hasOwn(UPCOMING_INTERESTS, slug) ? slug : null;
}

// { ok, outcome, token, sendWelcome } or { ok: false, error }.
export async function subscribe({ email, source, country, interest }) {
    return rpc('newsletter_subscribe', {
        p_email: email,
        p_source: source,
        p_country: country || null,
        p_interest: cleanInterest(interest)
    }, 'newsletter subscribe');
}

export async function markWelcomeSent(token) {
    try {
        await rpc('newsletter_welcome_sent', { p_token: token }, 'newsletter welcome sent');
    } catch (error) {
        // Only affects whether a repeat signup re-sends the welcome.
        console.error(describeSupabaseError(error, 'newsletter: mark welcome sent'));
    }
}

export function unsubscribe({ token, email, source }) {
    return rpc('newsletter_unsubscribe', {
        p_token: token || null,
        p_email: email || null,
        p_source: source
    }, 'newsletter unsubscribe');
}

export function stats() {
    return rpc('newsletter_stats', {}, 'newsletter stats');
}

// Sends one email through Resend. Returns true on success; never throws.
export async function sendEmail({ from = 'VOID© <support@eternalvoid.co>', to, subject, html, headers }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
        console.warn('newsletter: RESEND_API_KEY not set — email not sent');
        return false;
    }
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, subject, headers, html })
        });
        if (!res.ok) console.error('newsletter: email provider refused', res.status);
        return res.ok;
    } catch (error) {
        console.error('newsletter: email provider unreachable', error.message);
        return false;
    }
}

// Everyone who may be emailed, with a personal unsubscribe link for each — the
// list a drop notification is sent to. Unsubscribed addresses are never in it.
export async function audienceCsv() {
    const rows = await selectRows(
        '/newsletter_audience?select=email,country,interests,sources,consent_at,unsubscribe_token&order=consent_at.asc',
        'newsletter audience'
    );
    const cell = (value) => {
        const text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value);
        // Quote everything; neutralise spreadsheet formulas.
        const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = ['email', 'country', 'interests', 'sources', 'consented_at', 'unsubscribe_url'];
    const lines = (rows || []).map((r) => [r.email, r.country, r.interests, r.sources, r.consent_at,
        unsubscribePageUrl(r.unsubscribe_token)].map(cell).join(','));
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
}

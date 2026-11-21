// ─────────────────────────────────────────────────────────────────────────────
// POST /api/artist-opening — "Notify me" on /for-artists.
//
//   { email, locale, newsletter }
//
// Signs the address up for one thing: the announcement that EV for Artists is
// open for submissions (artist_opening_list). The general newsletter is a
// separate, unticked choice: only when `newsletter === true` is the address
// also passed to the newsletter's own signup, unchanged, with the programme
// recorded as its interest. Without it, newsletter_subscribers is not read or
// written at all, so an existing newsletter preference — subscribed or not —
// is exactly what it was.
//
// One confirmation email per signup (not per press), and the same answer
// whether or not the address was already on either list.
// ─────────────────────────────────────────────────────────────────────────────
import {
    EMAIL_RE, newsletterConfigured, subscribe, markWelcomeSent, sendEmail,
    unsubscribePageUrl, unsubscribeHeaders
} from './_newsletter.js';
import { rpc, describeSupabaseError } from './_orders.js';

const LOCALES = ['en', 'fr', 'it', 'de'];

export function unsubscribeOpening({ token, email, source }) {
    return rpc('artist_opening_unsubscribe', {
        p_token: token || null, p_email: email || null, p_source: source
    }, 'artist opening unsubscribe');
}

export const isOpeningToken = (token) => /^ao[0-9a-f]{64}$/.test(String(token || ''));

function confirmationHtml({ openingUnsubscribe, newsletterUnsubscribe }) {
    return `
                <div style="margin:0;background:#000;color:#f5f2ec;font-family:Arial,Helvetica,sans-serif;padding:28px 16px;line-height:1.7;">
                    <div style="max-width:620px;margin:0 auto;border-top:1px solid rgba(199,169,108,0.58);border-bottom:1px solid rgba(255,255,255,0.08);background:#000;padding:34px 26px;">
                        <div style="color:#c7a96c;font-size:10px;letter-spacing:0.3em;text-transform:uppercase;margin-bottom:14px;">EV for Artists</div>
                        <h1 style="color:#f8f1e4;font-family:Georgia,serif;font-size:25px;font-weight:400;line-height:1.25;margin:0 0 16px;">We will write when submissions open.</h1>
                        <p style="color:#bdb5a8;font-size:13px;line-height:1.8;margin:0 0 18px;">Thank you. Your address is on the list for one email: the announcement that EV for Artists is open for submissions. A sketch is enough to start.</p>
                        ${newsletterUnsubscribe ? '<p style="color:#bdb5a8;font-size:13px;line-height:1.8;margin:0 0 18px;">You also asked for the ETERNAL VOID newsletter, so that will reach you separately.</p>' : ''}
                        <div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0 16px;"></div>
                        <p style="color:#8f8778;font-size:11px;line-height:1.6;margin:0 0 8px;"><a href="https://eternalvoid.co/for-artists" style="color:#c7a96c;text-decoration:none;">eternalvoid.co/for-artists</a> &middot; <a href="mailto:artists@eternalvoid.co" style="color:#8f8778;text-decoration:none;">artists@eternalvoid.co</a></p>
                        <p style="color:#6f675b;font-size:10px;line-height:1.6;margin:0;">
                            Changed your mind? <a href="${openingUnsubscribe}" style="color:#8f8778;text-decoration:underline;">Leave the opening list</a>${newsletterUnsubscribe ? ` &middot; <a href="${newsletterUnsubscribe}" style="color:#8f8778;text-decoration:underline;">Unsubscribe from the newsletter</a>` : ''}.
                            Read the <a href="https://eternalvoid.co/legal/ev-for-artists-privacy-notice" style="color:#8f8778;text-decoration:underline;">Submission Privacy Notice</a>.
                        </p>
                    </div>
                </div>
            `;
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ message: 'Method not allowed.' });
    }
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const locale = LOCALES.includes(body.locale) ? body.locale : null;
    const wantsNewsletter = body.newsletter === true;

    if (!EMAIL_RE.test(email)) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (!newsletterConfigured()) {
        return response.status(503).json({ message: 'Signup is not available right now.' });
    }

    let opening;
    try {
        opening = await rpc('artist_opening_subscribe', { p_email: email, p_locale: locale }, 'artist opening subscribe');
    } catch (error) {
        console.error(describeSupabaseError(error, 'artist opening: save'));
        return response.status(502).json({ message: 'We could not sign you up right now. Please try again.' });
    }
    if (!opening || !opening.ok) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }

    // The newsletter only on an explicit yes, through its own signup.
    let news = null;
    if (wantsNewsletter) {
        try {
            news = await subscribe({ email, source: 'newsletter', interest: 'ev-for-artists' });
        } catch (error) {
            console.error(describeSupabaseError(error, 'artist opening: newsletter opt-in'));
        }
    }

    let sent = true;
    if (opening.sendConfirmation || (news && news.ok && news.sendWelcome)) {
        sent = await sendEmail({
            from: 'EV for Artists <artists@eternalvoid.co>',
            to: email,
            subject: 'EV for Artists — we will write when submissions open',
            headers: unsubscribeHeaders(opening.token),
            html: confirmationHtml({
                openingUnsubscribe: unsubscribePageUrl(opening.token),
                newsletterUnsubscribe: news && news.ok ? unsubscribePageUrl(news.token) : null
            })
        });
        if (sent) {
            try {
                await rpc('artist_opening_confirmation_sent', { p_token: opening.token }, 'artist opening sent');
                // One email covers both, so the newsletter's own welcome is
                // marked sent rather than following a minute later.
                if (news && news.ok) await markWelcomeSent(news.token);
            } catch (error) {
                console.error(describeSupabaseError(error, 'artist opening: mark sent'));
            }
        }
    }

    return response.status(200).json({ ok: true, confirmationSent: sent });
}

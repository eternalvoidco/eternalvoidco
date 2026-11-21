// ─────────────────────────────────────────────────────────────────────────────
// POST /api/newsletter — the footer newsletter form, and the "Get Drop
// Updates" scene inside the product view, which also sends the piece being
// viewed as `interest` (validated against the catalogue in _newsletter.js),
// and "Receive the unveiling" on /fragrance, which sends `neant`.
//
// Saves the address first (newsletter_subscribers), then sends the welcome
// email. Nothing is emailed for a signup that was not recorded. A repeat
// signup does not re-send the welcome within a day of the last one.
// ─────────────────────────────────────────────────────────────────────────────
import {
    EMAIL_RE, newsletterConfigured, subscribe, markWelcomeSent, sendEmail,
    unsubscribePageUrl, unsubscribeHeaders
} from './_newsletter.js';
import { describeSupabaseError } from './_orders.js';

function welcomeHtml(unsubscribeUrl) {
    return `
                <div style="margin:0;background:#000;color:#f5f2ec;font-family:Arial,Helvetica,sans-serif;padding:28px 16px;line-height:1.7;">
                    <div style="max-width:760px;margin:0 auto;border-top:1px solid rgba(199,169,108,0.58);border-bottom:1px solid rgba(255,255,255,0.08);background:#000;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                            <tr>
                                <td style="width:34%;padding:34px 26px;vertical-align:top;">
                                    <div style="display:inline-block;text-align:left;">
                                        <div style="color:#fff;font-family:Georgia,serif;font-size:25px;font-weight:400;letter-spacing:0.34em;line-height:1;">VOID</div>
                                        <div style="color:rgba(199,169,108,0.58);font-size:7px;letter-spacing:0.32em;text-transform:uppercase;margin-top:12px;">FEEL THE</div>
                                    </div>
                                </td>
                                <td style="padding:34px 26px 34px 22px;vertical-align:top;">
                                    <div style="color:#f5f2ec;font-family:Georgia,serif;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:16px;">Newsletter</div>
                                    <h1 style="color:#f8f1e4;font-family:Georgia,serif;font-size:27px;font-weight:400;line-height:1.18;margin:0 0 16px;">You are inside the VOID.</h1>
                                    <p style="color:#bdb5a8;font-size:13px;line-height:1.8;margin:0 0 18px;max-width:420px;">Thank you for signing up. You will receive exclusive drops, preorder access, and quiet updates before the collection opens.</p>
                                    <div style="display:inline-block;border:1px solid rgba(199,169,108,0.62);color:#c7a96c;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:10px 16px;margin:4px 0 18px;">Access Confirmed</div>
                                    <div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0 16px;"></div>
                                    <a href="mailto:support@eternalvoid.co" style="color:#8f8778;text-decoration:none;font-size:11px;">support@eternalvoid.co</a>
                                    <div style="height:1px;background:rgba(255,255,255,0.08);margin:16px 0 12px;"></div>
                                    <p style="color:#8f8778;font-size:11px;line-height:1.6;margin:0 0 8px;"><a href="https://eternalvoid.co" style="color:#c7a96c;text-decoration:none;">Return to eternalvoid.co</a></p>
                                    <p style="color:#6f675b;font-size:10px;line-height:1.6;margin:0;">No longer want these emails? <a href="${unsubscribeUrl}" style="color:#8f8778;text-decoration:underline;">Unsubscribe</a>. Read our <a href="https://eternalvoid.co/privacy-policy.html" style="color:#8f8778;text-decoration:underline;">Privacy Policy</a>.</p>
                                </td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ message: 'Method not allowed.' });
    }

    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
    const interest = typeof request.body?.interest === 'string' ? request.body.interest : '';
    if (!EMAIL_RE.test(email)) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }

    if (!newsletterConfigured()) {
        return response.status(503).json({ message: 'Newsletter signup is not available right now.' });
    }

    let saved;
    try {
        saved = await subscribe({ email, source: 'newsletter', interest });
    } catch (error) {
        console.error(describeSupabaseError(error, 'newsletter: save'));
        return response.status(502).json({ message: 'We could not sign you up right now. Please try again.' });
    }
    if (!saved || !saved.ok) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }

    let sent = true;
    if (saved.sendWelcome) {
        sent = await sendEmail({
            from: 'VOID <support@eternalvoid.co>',
            to: email,
            subject: 'Thank you for signing up to VOID',
            headers: unsubscribeHeaders(saved.token),
            html: welcomeHtml(unsubscribePageUrl(saved.token))
        });
        if (sent) await markWelcomeSent(saved.token);
    }

    // The same answer whether or not the address was already on the list, so
    // the form cannot be used to find out who is subscribed.
    return response.status(200).json({
        ok: true,
        // Lets a page show its own translated copy; `message` stays for the
        // footer form, which displays it as is.
        welcomeSent: sent,
        message: sent
            ? 'Thank you for signing up to the VOID newsletter. Please check your email.'
            : 'You are on the VOID newsletter list. We could not send the confirmation email just now.'
    });
}

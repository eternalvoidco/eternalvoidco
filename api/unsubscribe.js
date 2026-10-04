// ─────────────────────────────────────────────────────────────────────────────
// POST /api/unsubscribe
//
// Three ways in, one effect: the address is marked unsubscribed in
// newsletter_subscribers and is never emailed again unless that person signs
// up through a form once more.
//
//   POST ?token=…  body List-Unsubscribe=One-Click   RFC 8058 one-click, sent
//                                                     by mail clients from the
//                                                     List-Unsubscribe header
//   POST { token }                                    the link in an email,
//                                                     confirmed on the page
//   POST { email }                                    the unsubscribe page form
//
// A GET never unsubscribes: mail scanners open links.
// ─────────────────────────────────────────────────────────────────────────────
import { EMAIL_RE, newsletterConfigured, unsubscribe, sendEmail } from './_newsletter.js';
import { describeSupabaseError } from './_orders.js';

const DONE = 'You have been unsubscribed from VOID emails.';

function confirmationHtml() {
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
                                    <div style="color:#f5f2ec;font-family:Georgia,serif;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:16px;">Unsubscribe Confirmed</div>
                                    <h1 style="color:#f8f1e4;font-family:Georgia,serif;font-size:27px;font-weight:400;line-height:1.18;margin:0 0 16px;">Your request has been received.</h1>
                                    <p style="color:#bdb5a8;font-size:13px;line-height:1.8;margin:0 0 18px;max-width:420px;">This address has been removed from VOID newsletter and pre-order email communications.</p>
                                    <a href="mailto:support@eternalvoid.co" style="color:#8f8778;text-decoration:none;font-size:11px;">support@eternalvoid.co</a>
                                    <div style="height:1px;background:rgba(255,255,255,0.08);margin:16px 0 12px;"></div>
                                    <p style="color:#6f675b;font-size:10px;line-height:1.6;margin:0;">Read our <a href="https://eternalvoid.co/privacy-policy.html" style="color:#8f8778;text-decoration:underline;">Privacy Policy</a>.</p>
                                </td>
                            </tr>
                        </table>
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

    if (!newsletterConfigured()) {
        return response.status(503).json({ message: 'Unsubscribe service is not configured yet.' });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const queryToken = typeof (request.query || {}).token === 'string' ? request.query.token : '';
    const bodyToken = typeof body.token === 'string' ? body.token : '';
    const token = (queryToken || bodyToken).trim().slice(0, 128);
    const email = typeof body.email === 'string' ? body.email.trim() : '';

    if (!token && !EMAIL_RE.test(email)) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }

    let result;
    try {
        result = await unsubscribe({
            token,
            email: token ? null : email,
            source: queryToken ? 'one_click' : token ? 'email_link' : 'unsubscribe_page'
        });
    } catch (error) {
        console.error(describeSupabaseError(error, 'unsubscribe'));
        return response.status(502).json({ message: 'Unable to process unsubscribe request right now.' });
    }
    if (!result || !result.ok) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (result.outcome === 'not_found') {
        return response.status(404).json({ message: 'This unsubscribe link is not valid. Enter your email address below instead.' });
    }

    // The page form also confirms by email, as it always has — which tells the
    // owner of an address if someone else removed it. Link and one-click
    // unsubscribes are silent, as RFC 8058 expects. The removal itself is
    // already recorded either way, so a failed email does not fail the request.
    if (!token && result.outcome === 'unsubscribed') {
        await sendEmail({
            from: 'VOID <support@eternalvoid.co>',
            to: email,
            subject: 'You have been unsubscribed from VOID emails',
            html: confirmationHtml()
        });
    }

    return response.status(200).json({ message: DONE });
}

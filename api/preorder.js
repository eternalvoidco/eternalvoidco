// ─────────────────────────────────────────────────────────────────────────────
// POST /api/preorder — the pre-order signup popup ("Reserve the next VOID©
// drop"), which is also what "Get notified for the next drop" opens on a
// sold-out piece.
//
// Saves the address first (newsletter_subscribers, with the country and, when
// it came from a sold-out piece, that design as an interest), then sends the
// welcome email. Nothing is emailed for a signup that was not recorded. A
// repeat signup does not re-send the welcome within a day of the last one.
// ─────────────────────────────────────────────────────────────────────────────
import {
    EMAIL_RE, newsletterConfigured, subscribe, markWelcomeSent, sendEmail,
    unsubscribePageUrl, unsubscribeHeaders
} from './_newsletter.js';
import { describeSupabaseError } from './_orders.js';

function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function welcomeHtml(safeCountry, unsubscribeUrl) {
    return `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;background-color:#000000;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-scheme" content="light dark">
<title>Welcome to the VOID&#169; Private Access Club</title>
<style>
:root { color-scheme: light dark; supported-color-scheme: light dark; }
body { margin:0 !important; padding:0 !important; background-color:#000000 !important; }
a { color:#c7a96c; }
/* Force the same dark palette in BOTH schemes so no phone client re-tints or
   synthesizes a light version of this dark-designed email. */
@media (prefers-color-scheme: light) {
  body,.void-bg,.void-cell{background-color:#000000!important;}
  .void-white{color:#ffffff!important;} .void-primary{color:#f5f2ec!important;}
  .void-h1{color:#f8f1e4!important;} .void-body{color:#bdb5a8!important;}
  .void-muted{color:#8f8778!important;} .void-faint{color:#6f675b!important;}
  .void-gold{color:#c7a96c!important;} .void-feel{color:#8a7655!important;}
}
@media (prefers-color-scheme: dark) {
  body,.void-bg,.void-cell{background-color:#000000!important;}
  .void-white{color:#ffffff!important;} .void-primary{color:#f5f2ec!important;}
  .void-h1{color:#f8f1e4!important;} .void-body{color:#bdb5a8!important;}
  .void-muted{color:#8f8778!important;} .void-faint{color:#6f675b!important;}
  .void-gold{color:#c7a96c!important;} .void-feel{color:#8a7655!important;}
}
/* Outlook.com / Outlook mobile dark-mode overrides */
[data-ogsb] .void-bg,[data-ogsb] .void-cell{background-color:#000000!important;}
[data-ogsc] .void-white{color:#ffffff!important;}
[data-ogsc] .void-primary{color:#f5f2ec!important;}
[data-ogsc] .void-h1{color:#f8f1e4!important;}
[data-ogsc] .void-body{color:#bdb5a8!important;}
[data-ogsc] .void-muted{color:#8f8778!important;}
[data-ogsc] .void-faint{color:#6f675b!important;}
[data-ogsc] .void-gold{color:#c7a96c!important;}
</style>
</head>
<body class="body" style="margin:0;padding:0;background-color:#000000;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:#000000;font-size:1px;line-height:1px;">Your VOID&#169; pre-order access is reserved &mdash; early access and priority drop updates.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#000000" class="void-bg" data-ogsb="#000000" style="border-collapse:collapse;background-color:#000000;">
<tr>
<td align="center" bgcolor="#000000" class="void-cell" data-ogsb="#000000" style="padding:28px 16px;background-color:#000000;">
<table role="presentation" width="760" cellspacing="0" cellpadding="0" border="0" bgcolor="#000000" class="void-bg" data-ogsb="#000000" style="width:100%;max-width:760px;border-collapse:collapse;background-color:#000000;border-top:1px solid #73623f;border-bottom:1px solid #141414;">
<tr>
<td width="220" valign="top" bgcolor="#000000" class="void-cell" data-ogsb="#000000" style="width:34%;padding:34px 26px;vertical-align:top;background-color:#000000;">
<div class="void-white" style="color:#ffffff;font-family:Georgia,serif;font-size:25px;font-weight:400;letter-spacing:0.34em;line-height:1;">VOID<sup style="display:inline-block;margin-left:0.03em;font-size:0.36em;line-height:0;letter-spacing:0;vertical-align:super;">&#169;</sup></div>
<div class="void-feel" style="color:#8a7655;font-size:7px;letter-spacing:0.32em;text-transform:uppercase;margin-top:12px;">FEEL THE</div>
</td>
<td valign="top" bgcolor="#000000" class="void-cell" data-ogsb="#000000" style="padding:34px 26px 34px 22px;vertical-align:top;background-color:#000000;">
<div class="void-primary" style="color:#f5f2ec;font-family:Georgia,serif;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:16px;">Private Access Club</div>
<h1 class="void-h1" style="color:#f8f1e4;font-family:Georgia,serif;font-size:27px;font-weight:400;line-height:1.18;margin:0 0 16px;">Welcome to the VOID<sup style="display:inline-block;margin-left:0.06em;font-size:0.44em;line-height:0;letter-spacing:0;vertical-align:super;">&#169;</sup> private access club.</h1>
<p class="void-body" style="color:#bdb5a8;font-size:13px;line-height:1.8;margin:0 0 18px;max-width:430px;">Your pre-order request has been received. You are now on the private list for early access, quiet release notes, and priority updates before the next VOID<sup style="display:inline-block;margin-left:0.06em;font-size:0.44em;line-height:0;letter-spacing:0;vertical-align:super;">&#169;</sup> drop opens.</p>
<div class="void-gold" style="display:inline-block;border:1px solid #7b6943;color:#c7a96c;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:10px 16px;margin:4px 0 18px;">Pre-order Access Reserved</div>
<div style="height:1px;background-color:#141414;line-height:1px;font-size:1px;margin:4px 0 16px;">&nbsp;</div>
<p class="void-muted" style="color:#8f8778;font-size:11px;margin:0;">Country: ${safeCountry}</p>
<a class="void-muted" href="mailto:support@eternalvoid.co" style="color:#8f8778;text-decoration:none;font-size:11px;">support@eternalvoid.co</a>
<div style="height:1px;background-color:#141414;line-height:1px;font-size:1px;margin:16px 0 12px;">&nbsp;</div>
<p style="margin:0 0 8px;"><a class="void-gold" href="https://eternalvoid.co" style="color:#c7a96c;text-decoration:none;font-size:11px;">Return to eternalvoid.co</a></p>
<p class="void-faint" style="color:#6f675b;font-size:10px;line-height:1.6;margin:0;">No longer want these emails? <a class="void-muted" href="${unsubscribeUrl}" style="color:#8f8778;text-decoration:underline;">Unsubscribe</a>. Read our <a class="void-muted" href="https://eternalvoid.co/privacy-policy.html" style="color:#8f8778;text-decoration:underline;">Privacy Policy</a>.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ message: 'Method not allowed.' });
    }

    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
    const country = typeof request.body?.country === 'string' ? request.body.country.trim().slice(0, 80) : '';
    const interest = typeof request.body?.interest === 'string' ? request.body.interest : '';

    if (!EMAIL_RE.test(email)) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }

    if (!country) {
        return response.status(400).json({ message: 'Please select your country.' });
    }

    if (!newsletterConfigured()) {
        return response.status(503).json({ message: 'Pre-order signup is not available right now.' });
    }

    let saved;
    try {
        saved = await subscribe({ email, source: 'preorder', country, interest });
    } catch (error) {
        console.error(describeSupabaseError(error, 'preorder: save'));
        return response.status(502).json({ message: 'We could not add you to the list right now. Please try again.' });
    }
    if (!saved || !saved.ok) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }

    let sent = true;
    if (saved.sendWelcome) {
        sent = await sendEmail({
            from: 'VOID© <support@eternalvoid.co>',
            to: email,
            subject: 'Welcome to the VOID© Private Access Club',
            headers: unsubscribeHeaders(saved.token),
            html: welcomeHtml(escapeHtml(country), unsubscribePageUrl(saved.token))
        });
        if (sent) await markWelcomeSent(saved.token);
    }

    // The same answer whether or not the address was already on the list, so
    // the form cannot be used to find out who is subscribed.
    return response.status(200).json({
        message: sent
            ? 'Welcome to the VOID© private access club. Please check your email.'
            : 'You are on the VOID© private access list. We could not send the confirmation email just now.'
    });
}

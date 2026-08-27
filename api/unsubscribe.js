function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ message: 'Method not allowed.' });
    }

    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!isValidEmail) {
        return response.status(400).json({ message: 'Please enter a valid email address.' });
    }

    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
        return response.status(500).json({ message: 'Unsubscribe service is not configured yet.' });
    }

    const headers = {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
    };
    const safeEmail = escapeHtml(email);

    const ownerNotification = fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            from: 'VOID <support@eternalvoid.co>',
            to: 'support@eternalvoid.co',
            reply_to: email,
            subject: 'VOID unsubscribe request',
            html: `
                <div style="background:#000;color:#f5f2ec;font-family:Arial,Helvetica,sans-serif;padding:28px;line-height:1.7;">
                    <div style="max-width:620px;margin:0 auto;border-top:1px solid rgba(199,169,108,0.58);padding-top:24px;">
                        <h1 style="font-family:Georgia,serif;font-weight:400;margin:0 0 16px;">Unsubscribe request</h1>
                        <p style="color:#bdb5a8;margin:0 0 12px;">Please remove this address from VOID newsletter and preorder email communications:</p>
                        <p style="color:#c7a96c;margin:0;font-size:16px;">${safeEmail}</p>
                    </div>
                </div>
            `
        })
    });

    const userConfirmation = fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            from: 'VOID <support@eternalvoid.co>',
            to: email,
            subject: 'You have been unsubscribed from VOID emails',
            html: `
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
                                    <p style="color:#bdb5a8;font-size:13px;line-height:1.8;margin:0 0 18px;max-width:420px;">We will remove this address from VOID newsletter and preorder email communications.</p>
                                    <a href="mailto:support@eternalvoid.co" style="color:#8f8778;text-decoration:none;font-size:11px;">support@eternalvoid.co</a>
                                    <div style="height:1px;background:rgba(255,255,255,0.08);margin:16px 0 12px;"></div>
                                    <p style="color:#6f675b;font-size:10px;line-height:1.6;margin:0;">Read our <a href="https://eternalvoid.co/privacy-policy.html" style="color:#8f8778;text-decoration:underline;">Privacy Policy</a>.</p>
                                </td>
                            </tr>
                        </table>
                    </div>
                </div>
            `
        })
    });

    const results = await Promise.all([ownerNotification, userConfirmation]);

    if (results.some((result) => !result.ok)) {
        return response.status(502).json({ message: 'Unable to process unsubscribe request right now.' });
    }

    return response.status(200).json({ message: 'You have been unsubscribed from VOID emails.' });
}

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
        return response.status(500).json({ message: 'Newsletter email service is not configured yet.' });
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: 'VOID <support@eternalvoid.co>',
            to: email,
            subject: 'Thank you for signing up to VOID',
            html: `
                <div style="margin:0;background:#000;color:#f5f2ec;font-family:Arial,Helvetica,sans-serif;padding:28px 16px;line-height:1.7;">
                    <div style="max-width:760px;margin:0 auto;border-top:1px solid rgba(199,169,108,0.58);border-bottom:1px solid rgba(255,255,255,0.08);background:#000;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                            <tr>
                                <td style="width:34%;padding:34px 26px;vertical-align:top;">
                                    <div style="color:#fff;font-family:Georgia,serif;font-size:25px;font-weight:400;letter-spacing:0.34em;line-height:1;text-indent:0.34em;">VOID</div>
                                    <div style="color:rgba(199,169,108,0.58);font-size:7px;letter-spacing:0.32em;text-transform:uppercase;margin-top:12px;">FEEL THE</div>
                                </td>
                                <td style="padding:34px 26px 34px 22px;vertical-align:top;">
                                    <div style="color:#f5f2ec;font-family:Georgia,serif;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:16px;">Newsletter</div>
                                    <h1 style="color:#f8f1e4;font-family:Georgia,serif;font-size:27px;font-weight:400;line-height:1.18;margin:0 0 16px;">You are inside the VOID.</h1>
                                    <p style="color:#bdb5a8;font-size:13px;line-height:1.8;margin:0 0 18px;max-width:420px;">Thank you for signing up. You will receive exclusive drops, preorder access, and quiet updates before the collection opens.</p>
                                    <div style="display:inline-block;border:1px solid rgba(199,169,108,0.62);color:#c7a96c;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:10px 16px;margin:4px 0 18px;">Access Confirmed</div>
                                    <div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0 16px;"></div>
                                    <a href="mailto:support@eternalvoid.co" style="color:#8f8778;text-decoration:none;font-size:11px;">support@eternalvoid.co</a>
                                </td>
                            </tr>
                        </table>
                    </div>
                </div>
            `
        })
    });

    if (!resendResponse.ok) {
        return response.status(502).json({ message: 'Unable to send confirmation email right now.' });
    }

    return response.status(200).json({ message: 'Thank you for signing up to the VOID newsletter. Please check your email.' });
}

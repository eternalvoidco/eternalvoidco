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
                <div style="margin:0;background:#050505;color:#f5f2ec;font-family:Arial,Helvetica,sans-serif;padding:36px 18px;line-height:1.7;">
                    <div style="max-width:590px;margin:0 auto;background:#070707;border:1px solid rgba(199,169,108,0.34);box-shadow:0 26px 70px rgba(0,0,0,0.46);">
                        <div style="padding:38px 28px 28px;text-align:center;border-bottom:1px solid rgba(199,169,108,0.18);background:radial-gradient(circle at top,rgba(199,169,108,0.18),transparent 42%),linear-gradient(135deg,#060606,#14100a 58%,#070707);">
                            <div style="display:inline-block;padding:9px;border:1px solid rgba(199,169,108,0.26);">
                                <div style="border:1px solid rgba(199,169,108,0.72);padding:16px 24px;color:#d9bd78;font-family:Georgia,serif;font-size:30px;font-weight:400;letter-spacing:0.34em;text-indent:0.34em;text-shadow:0 0 22px rgba(199,169,108,0.28);">VOID</div>
                            </div>
                            <p style="color:#c7a96c;letter-spacing:0.32em;text-transform:uppercase;font-size:10px;margin:18px 0 0;">Private Newsletter Access</p>
                        </div>
                        <div style="padding:34px 30px 36px;">
                            <h1 style="color:#f8f1e4;font-family:Georgia,serif;font-size:34px;font-weight:400;line-height:1.15;margin:0 0 18px;text-align:center;">Thank you for signing up.</h1>
                            <p style="color:#cfc7b8;font-size:15px;margin:0 0 20px;text-align:center;">You are now on the VOID newsletter list. We will contact you with exclusive drops, preorder access, and brand updates.</p>
                            <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(199,169,108,0.55),transparent);margin:28px 0;"></div>
                            <p style="font-size:13px;margin:0;text-align:center;"><a href="mailto:support@eternalvoid.co" style="color:#c7a96c;text-decoration:none;letter-spacing:0.08em;">support@eternalvoid.co</a></p>
                        </div>
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

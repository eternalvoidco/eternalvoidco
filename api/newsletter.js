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
                <div style="background:#080808;color:#f5f2ec;font-family:Arial,sans-serif;padding:32px;line-height:1.7;">
                    <div style="max-width:560px;margin:0 auto;border:1px solid rgba(199,169,108,0.35);padding:32px;">
                        <p style="color:#c7a96c;letter-spacing:0.22em;text-transform:uppercase;font-size:12px;margin:0 0 18px;">VOID Newsletter</p>
                        <h1 style="font-size:34px;font-weight:400;margin:0 0 18px;">Thank you for signing up.</h1>
                        <p style="color:#cfc7b8;margin:0 0 18px;">You are now on the VOID newsletter list. We will contact you with exclusive drops, preorder access, and brand updates.</p>
                        <p style="color:#8f8778;margin:0;">Eternal VOID</p>
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

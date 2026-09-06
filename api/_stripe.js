// ─────────────────────────────────────────────────────────────────────────────
// Stripe over the REST API.
//
// This project has no package.json and no build step — every other integration
// here (Resend, Supabase config) is a plain fetch, so the Stripe node SDK would
// mean introducing npm to a static site for two endpoints. Stripe's REST API is
// a first-class, versioned interface; this talks to it directly and keeps the
// secret key server-side.
//
// Signature verification uses node's built-in crypto, so still no dependency.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';

const API = 'https://api.stripe.com/v1';

// Pinned so a future default-version change on the account cannot silently
// alter response shapes underneath us.
const API_VERSION = '2024-06-20';

export function stripeConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
}

// Stripe takes form-encoded bodies with bracket notation for nested values.
function encode(value, prefix, out) {
    if (value == null) return;
    if (Array.isArray(value)) {
        value.forEach((item, i) => encode(item, `${prefix}[${i}]`, out));
        return;
    }
    if (typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => encode(item, `${prefix}[${key}]`, out));
        return;
    }
    out.append(prefix, String(value));
}

export function formBody(payload) {
    const out = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => encode(value, key, out));
    return out;
}

async function call(path, { method = 'POST', payload, idempotencyKey } = {}) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw Object.assign(new Error('stripe_not_configured'), { code: 'stripe_not_configured' });

    const headers = {
        Authorization: `Bearer ${key}`,
        'Stripe-Version': API_VERSION
    };
    if (payload) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    // Lets a retried request re-use the same PaymentIntent instead of opening a
    // second one for the same order.
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: payload ? formBody(payload).toString() : undefined
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = (data && data.error && data.error.message) || 'stripe_request_failed';
        throw Object.assign(new Error(message), { code: 'stripe_error', status: res.status, stripe: data.error });
    }
    return data;
}

export function createPaymentIntent(payload, idempotencyKey) {
    return call('/payment_intents', { payload, idempotencyKey });
}

export function updatePaymentIntent(id, payload) {
    return call(`/payment_intents/${encodeURIComponent(id)}`, { payload });
}

export function retrievePaymentIntent(id) {
    return call(`/payment_intents/${encodeURIComponent(id)}`, { method: 'GET' });
}

// ── Webhook signature ────────────────────────────────────────────────────────
// Stripe signs `${timestamp}.${rawBody}` with the endpoint secret. Verified
// against the raw bytes — a parsed-and-restringified body will not match.
export function verifyWebhook(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
    if (!rawBody || !signatureHeader || !secret) return { ok: false, reason: 'missing_input' };

    const parts = String(signatureHeader).split(',').reduce((acc, chunk) => {
        const [k, v] = chunk.split('=');
        if (k === 't') acc.t = v;
        if (k === 'v1') acc.v1.push(v);
        return acc;
    }, { t: null, v1: [] });

    if (!parts.t || parts.v1.length === 0) return { ok: false, reason: 'malformed_signature' };

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
    if (!Number.isFinite(age) || age > toleranceSeconds) return { ok: false, reason: 'timestamp_out_of_tolerance' };

    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${parts.t}.${rawBody}`, 'utf8')
        .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const match = parts.v1.some((candidate) => {
        const candidateBuf = Buffer.from(candidate, 'utf8');
        // timingSafeEqual throws on length mismatch, so guard first.
        return candidateBuf.length === expectedBuf.length
            && crypto.timingSafeEqual(candidateBuf, expectedBuf);
    });

    if (!match) return { ok: false, reason: 'signature_mismatch' };

    try {
        return { ok: true, event: JSON.parse(rawBody) };
    } catch (e) {
        return { ok: false, reason: 'invalid_json' };
    }
}

// Vercel parses JSON bodies by default, which destroys the bytes the signature
// was computed over. The webhook route disables that and reads the stream here.
export function readRawBody(request) {
    return new Promise((resolve, reject) => {
        let data = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            data += chunk;
            if (data.length > 1_000_000) reject(new Error('body_too_large'));
        });
        request.on('end', () => resolve(data));
        request.on('error', reject);
    });
}

// A stateful stand-in for the slice of Stripe's REST API the checkout uses:
// create / retrieve / cancel a PaymentIntent, with idempotency keys, plus
// helpers to move an intent through its lifecycle and to sign webhook events
// exactly as Stripe does (HMAC-SHA256 over `${t}.${body}`).
//
// It is installed by wrapping globalThis.fetch, so requests to
// https://api.stripe.com never leave the process. Nothing here can create a
// real charge.
import crypto from 'node:crypto';

const BASE = 'https://api.stripe.com/v1';
const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;

function parseForm(body) {
    const out = {};
    for (const [key, value] of new URLSearchParams(body || '')) {
        // metadata[order_id] → { metadata: { order_id } }; good enough for the
        // two-level shapes the checkout sends.
        const parts = key.replace(/\]/g, '').split('[');
        let node = out;
        parts.forEach((part, i) => {
            if (i === parts.length - 1) node[part] = value;
            else node = node[part] || (node[part] = {});
        });
    }
    return out;
}

export function createStripeDouble({ webhookSecret }) {
    const intents = new Map();
    const idempotency = new Map();
    const calls = [];
    const faults = { create: null };

    const json = (status, body) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
    const stripeError = (status, code, message) => json(status, { error: { type: 'invalid_request_error', code, message } });

    function handle(method, path, body, headers) {
        calls.push({ method, path });

        if (method === 'POST' && path === '/payment_intents') {
            const key = headers['Idempotency-Key'];
            if (key && idempotency.has(key)) return json(200, intents.get(idempotency.get(key)));
            if (faults.create) {
                const fault = faults.create;
                faults.create = null;
                return stripeError(fault.status || 500, fault.code || 'api_error', 'injected failure');
            }
            const form = parseForm(body);
            const pi = {
                id: id('pi'),
                object: 'payment_intent',
                amount: Number(form.amount),
                amount_received: 0,
                currency: form.currency,
                metadata: form.metadata || {},
                status: 'requires_payment_method',
                last_payment_error: null,
                livemode: false
            };
            pi.client_secret = `${pi.id}_secret_${crypto.randomBytes(10).toString('hex')}`;
            intents.set(pi.id, pi);
            if (key) idempotency.set(key, pi.id);
            return json(200, pi);
        }

        const match = /^\/payment_intents\/([^/]+)(\/cancel)?$/.exec(path);
        if (match) {
            const pi = intents.get(decodeURIComponent(match[1]));
            if (!pi) return stripeError(404, 'resource_missing', 'No such payment_intent');
            if (method === 'GET' && !match[2]) return json(200, pi);
            if (method === 'POST' && match[2]) {
                const cancellable = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'];
                if (!cancellable.includes(pi.status)) {
                    return stripeError(400, 'payment_intent_unexpected_state',
                        `You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`);
                }
                pi.status = 'canceled';
                pi.cancellation_reason = parseForm(body).cancellation_reason || null;
                return json(200, pi);
            }
        }
        return stripeError(404, 'not_found', `unhandled ${method} ${path}`);
    }

    const realFetch = globalThis.fetch;
    function install() {
        globalThis.fetch = async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.startsWith(BASE)) {
                const auth = (init.headers && init.headers.Authorization) || '';
                if (!auth.startsWith('Bearer sk_test_')) return stripeError(401, 'auth', 'test keys only');
                return handle(init.method || 'GET', url.slice(BASE.length), init.body, init.headers || {});
            }
            if (url.startsWith('https://api.stripe.com')) throw new Error('unexpected Stripe URL ' + url);
            return realFetch(input, init);
        };
    }
    function uninstall() { globalThis.fetch = realFetch; }

    // ── lifecycle, as the customer's browser and the bank would drive it ──
    function get(piId) { return intents.get(piId); }
    function succeed(piId, { amountReceived } = {}) {
        const pi = intents.get(piId);
        pi.status = 'succeeded';
        pi.amount_received = amountReceived != null ? amountReceived : pi.amount;
        pi.last_payment_error = null;
        return pi;
    }
    function processing(piId) { const pi = intents.get(piId); pi.status = 'processing'; return pi; }
    function decline(piId) {
        const pi = intents.get(piId);
        pi.status = 'requires_payment_method';
        pi.last_payment_error = { code: 'card_declined', decline_code: 'generic_decline' };
        return pi;
    }

    // Builds a signed delivery. `snapshot` is the intent as the event saw it,
    // which may be older than its current state — exactly the out-of-order
    // case the webhook must survive.
    function event(type, snapshot, { eventId } = {}) {
        const payload = JSON.stringify({
            id: eventId || id('evt'),
            object: 'event',
            type,
            livemode: false,
            data: { object: JSON.parse(JSON.stringify(snapshot)) }
        });
        const t = Math.floor(Date.now() / 1000);
        const sig = crypto.createHmac('sha256', webhookSecret).update(`${t}.${payload}`, 'utf8').digest('hex');
        return { payload, signature: `t=${t},v1=${sig}` };
    }

    return { install, uninstall, get, succeed, processing, decline, event, intents, calls, faults };
}

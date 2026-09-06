// ─────────────────────────────────────────────────────────────────────────────
// Order persistence, over Supabase's REST interface with the service-role key.
//
// The service role bypasses RLS, so it only ever runs here — server-side, in a
// Vercel function, never shipped to the browser. The frontend keeps using the
// anon key for auth exactly as it does today.
//
// Every write in this file is trusted; every read is scoped. There is no path
// by which a client can name its own price, its own status or another
// customer's order.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';

const SERVICE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BASE = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

export function ordersConfigured() {
    return Boolean(BASE() && SERVICE_KEY());
}

// Supabase has two server key formats and they authenticate differently.
//
//   legacy  eyJ…            a JWT whose `role` claim carries the privilege, so
//                           PostgREST wants it in Authorization: Bearer.
//   current sb_secret_…     an opaque API key. It is resolved by the gateway
//                           from the `apikey` header; putting it in
//                           Authorization makes PostgREST try to decode it as
//                           a JWT, which fails and rejects the request.
//
// So Authorization is sent only when the key actually is a JWT. `apikey`
// carries the credential either way.
function isJwt(key) {
    return key.split('.').length === 3 && key.startsWith('ey');
}

// Safe to log: describes the shape of the key, never any part of its value.
export function keyKind() {
    const key = SERVICE_KEY();
    if (!key) return 'missing';
    if (key.startsWith('sb_secret_')) return 'sb_secret';
    if (key.startsWith('sb_publishable_')) return 'sb_publishable (WRONG — this is a public key)';
    if (isJwt(key)) return 'legacy_jwt';
    return 'unrecognised';
}

async function rest(path, { method = 'GET', body, prefer, op } = {}) {
    if (!ordersConfigured()) {
        throw Object.assign(new Error('orders_not_configured'), { code: 'orders_not_configured' });
    }

    const key = SERVICE_KEY();
    const headers = {
        apikey: key,
        'Content-Type': 'application/json'
    };
    if (isJwt(key)) headers.Authorization = `Bearer ${key}`;
    if (prefer) headers.Prefer = prefer;

    const res = await fetch(`${BASE()}/rest/v1${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (error) {
        // A gateway or proxy failure can answer with HTML. Keep a short excerpt
        // so the logs say something more useful than "unexpected token <".
        data = { message: 'non_json_response', body: text.slice(0, 300) };
    }

    if (!res.ok) {
        throw Object.assign(new Error((data && data.message) || 'supabase_request_failed'), {
            code: 'supabase_error',
            status: res.status,
            op: op || `${method} ${path.split('?')[0]}`,
            // PostgREST's own diagnostics: code, message, details, hint.
            pgCode: data && data.code,
            details: data && data.details,
            hint: data && data.hint,
            body: data
        });
    }
    return data;
}

// One line, everything needed to diagnose, nothing sensitive. Never touches the
// key value, the request body or any customer field.
export function describeSupabaseError(error, context) {
    if (!error) return `${context}: unknown error`;
    if (error.code !== 'supabase_error') return `${context}: ${error.code || error.name} — ${error.message}`;

    const parts = [
        `${context} failed`,
        `op=${error.op}`,
        `http=${error.status}`,
        error.pgCode ? `code=${error.pgCode}` : null,
        `message=${error.message}`,
        error.details ? `details=${String(error.details).slice(0, 300)}` : null,
        error.hint ? `hint=${String(error.hint).slice(0, 200)}` : null,
        `keyKind=${keyKind()}`
    ].filter(Boolean);

    return parts.join(' | ');
}

// ── Order numbers ────────────────────────────────────────────────────────────
// EV-<yy>-<6 random base32 chars>. Human-readable and collision-safe without a
// counter, which matters because there is no sequence to lock against. It is a
// label, never an authorisation: order reads still require the email.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford-ish, no I/L/O/U

export function generateOrderNumber(now = new Date()) {
    const yy = String(now.getUTCFullYear()).slice(-2);
    const bytes = crypto.randomBytes(6);
    let tail = '';
    for (let i = 0; i < 6; i += 1) tail += ALPHABET[bytes[i] % ALPHABET.length];
    return `EV-${yy}-${tail}`;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function createPendingOrder(order, items) {
    // order_number is random rather than sequential, so a collision is possible
    // even if vanishingly rare (32^6 ≈ 1.07e9). The unique constraint catches
    // it; retrying with a fresh number is cheaper than making the customer pay
    // for a birthday-paradox draw.
    let row;
    for (let attempt = 0; ; attempt += 1) {
        try {
            [row] = await rest('/orders', {
                method: 'POST',
                body: [order],
                prefer: 'return=representation',
                op: 'insert orders'
            });
            break;
        } catch (error) {
            if (error.status !== 409 || attempt >= 4) throw error;
            order = { ...order, order_number: generateOrderNumber() };
        }
    }

    if (items.length) {
        try {
            await rest('/order_items', {
                method: 'POST',
                body: items.map((item) => ({ ...item, order_id: row.id })),
                prefer: 'return=minimal',
                op: 'insert order_items'
            });
        } catch (error) {
            // An order with no lines is worse than no order: it would sit
            // pending forever and could never be fulfilled. Roll the header
            // back so the failure is clean, and keep the original cause.
            try {
                await rest(`/orders?id=eq.${encodeURIComponent(row.id)}`, {
                    method: 'DELETE',
                    prefer: 'return=minimal',
                    op: 'rollback orders'
                });
                error.rolledBack = true;
            } catch (cleanupError) {
                error.rolledBack = false;
                error.cleanupFailure = cleanupError.message;
            }
            throw error;
        }
    }
    return row;
}

export function attachPaymentIntent(orderId, paymentIntentId) {
    return rest(`/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        body: { stripe_payment_intent_id: paymentIntentId, updated_at: new Date().toISOString() },
        prefer: 'return=minimal',
        op: 'attach payment_intent'
    });
}

// Only ever moves a pending order forward, so a replayed or out-of-order
// webhook cannot resurrect an order that was already settled or cancelled.
export async function markOrderPaid(paymentIntentId, { amountReceived, currency }) {
    const rows = await rest(
        `/orders?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&select=*`,
        { op: 'find order by intent' }
    );
    const order = rows && rows[0];
    if (!order) return { ok: false, reason: 'order_not_found' };
    if (order.payment_status === 'paid') return { ok: true, order, alreadyPaid: true };

    // The webhook is authoritative, but it should still agree with what we
    // asked for. A mismatch is a bug or a tamper — record, do not fulfil.
    if (Number(amountReceived) !== Number(order.total_amount)
        || String(currency).toLowerCase() !== String(order.currency).toLowerCase()) {
        await rest(`/orders?id=eq.${encodeURIComponent(order.id)}`, {
            method: 'PATCH',
            body: { payment_status: 'failed', updated_at: new Date().toISOString() },
            prefer: 'return=minimal'
        });
        return { ok: false, reason: 'amount_mismatch', order };
    }

    const now = new Date().toISOString();
    const [updated] = await rest(
        `/orders?id=eq.${encodeURIComponent(order.id)}&payment_status=eq.pending`,
        {
            method: 'PATCH',
            body: { payment_status: 'paid', status: 'confirmed', paid_at: now, updated_at: now },
            prefer: 'return=representation'
        }
    );

    // Lost the race to a concurrent delivery of the same event; that delivery
    // owns the side effects.
    if (!updated) return { ok: true, order, alreadyPaid: true };
    return { ok: true, order: updated, alreadyPaid: false };
}

export async function markPaymentFailed(paymentIntentId) {
    await rest(
        `/orders?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&payment_status=eq.pending`,
        {
            method: 'PATCH',
            body: { payment_status: 'failed', updated_at: new Date().toISOString() },
            prefer: 'return=minimal'
        }
    );
}

// ── Idempotency ──────────────────────────────────────────────────────────────
// The insert is the lock: stripe_events.event_id is a primary key, so a
// duplicate delivery loses on conflict and returns false. Nothing downstream —
// stock, email — runs twice.
export async function claimEvent(eventId, type) {
    try {
        await rest('/stripe_events', {
            method: 'POST',
            body: [{ event_id: eventId, type }],
            prefer: 'return=minimal'
        });
        return true;
    } catch (error) {
        if (error.status === 409) return false;
        throw error;
    }
}

// ── Reads ────────────────────────────────────────────────────────────────────
// Guest lookup needs both the order number and the email it was placed with, so
// a guessed order number on its own reveals nothing.
export async function findOrderForConfirmation(orderNumber, email) {
    const number = String(orderNumber || '').trim().toUpperCase();
    const mail = String(email || '').trim().toLowerCase();
    if (!number || !mail) return null;

    const rows = await rest(
        `/orders?order_number=eq.${encodeURIComponent(number)}`
        + `&customer_email=eq.${encodeURIComponent(mail)}`
        + '&select=order_number,status,payment_status,currency,subtotal_amount,shipping_amount,'
        + 'tax_amount,total_amount,shipping_address,customer_email,customer_first_name,created_at,paid_at,'
        + 'order_items(product_name,size,sku,unit_amount,quantity,image_path)'
    );
    return (rows && rows[0]) || null;
}

export async function findOrderItems(orderId) {
    return rest(
        `/order_items?order_id=eq.${encodeURIComponent(orderId)}`
        + '&select=product_name,size,sku,unit_amount,quantity,image_path'
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/inventory
//
// One function for every inventory route, because Vercel's Hobby plan stops at
// twelve and this project already has ten. The routes do not share authority:
//
//   GET                        public. Availability per design and per size —
//                              what the storefront polls. Cached at the edge
//                              for a few seconds and ETagged, so polling from
//                              many tabs costs almost nothing.
//   GET  ?sweep=1              public, uncached. Ends checkouts whose holds
//                              have expired. Vercel cron calls this daily as a
//                              backstop; it is also run inline whenever a read
//                              finds expired holds, and before every checkout.
//                              Harmless to trigger: it only cancels what is
//                              already past its deadline.
//   GET  ?scope=admin          admin only. Full counts, holds, audit trail,
//                              newsletter subscriber counts.
//   GET  ?scope=admin&export=audience
//                              admin only. CSV of subscribed newsletter
//                              addresses, for sending a drop notification.
//   POST { action: 'adjust' }  admin only. Adjust, stocktake, or restock a
//                              return — through inventory_admin_adjust, which
//                              writes the audit row in the same transaction.
//
// Admin means: a valid Supabase session, a confirmed email, and that email in
// VOID_ADMIN_EMAILS — checked here, on the server, on every request.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { ordersConfigured, describeSupabaseError } from './_orders.js';
import { stripeConfigured } from './_stripe.js';
import { requireAdmin } from './_auth.js';
import { snapshot, summarize, sweepExpired, adminSnapshot, adminAdjust } from './_inventory.js';
import { stats as newsletterStats, audienceCsv } from './_newsletter.js';

const ADJUST_MODES = new Set(['adjust', 'set', 'return']);

async function publicRead(request, response) {
    let snap = await snapshot();

    // A hold past its deadline still counts as reserved until Stripe confirms
    // its checkout can no longer be paid, so the sweep runs before answering.
    if (snap.expiredHolds > 0 && stripeConfigured()) {
        try {
            await sweepExpired({ limit: 5 });
            snap = await snapshot();
        } catch (error) {
            console.error(describeSupabaseError(error, 'inventory: inline sweep'));
        }
    }

    // No timestamp in the body, so an unchanged stock picture keeps its ETag.
    const body = JSON.stringify({ ok: true, products: summarize(snap).products });
    const etag = `W/"${crypto.createHash('sha1').update(body).digest('base64url')}"`;

    // Browsers revalidate every time (max-age=0); the edge may answer for 3s.
    response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3, must-revalidate');
    response.setHeader('ETag', etag);
    if (request.headers['if-none-match'] === etag) return response.status(304).end();

    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    return response.status(200).send(body);
}

async function sweep(response) {
    response.setHeader('Cache-Control', 'no-store');
    if (!stripeConfigured()) return response.status(503).json({ error: 'stripe_not_configured' });
    const results = await sweepExpired({ limit: 20 });
    return response.status(200).json({ ok: true, swept: results.length, results });
}

async function adminRead(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const auth = await requireAdmin(request);
    if (!auth.ok) return response.status(auth.status).json({ error: auth.error });

    if ((request.query || {}).export === 'audience') {
        const csv = await audienceCsv();
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="void-newsletter-subscribed.csv"');
        return response.status(200).send(csv);
    }

    const data = await adminSnapshot();
    let newsletter = null;
    try {
        newsletter = await newsletterStats();
    } catch (error) {
        console.error(describeSupabaseError(error, 'inventory: newsletter stats'));
    }
    return response.status(200).json({ ok: true, admin: auth.user.email, ...data, newsletter });
}

async function adminWrite(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const auth = await requireAdmin(request);
    if (!auth.ok) return response.status(auth.status).json({ error: auth.error });

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    if (body.action === 'sweep') return sweep(response);
    if (body.action !== 'adjust') return response.status(400).json({ error: 'unknown_action' });

    const variantId = typeof body.variantId === 'string' ? body.variantId.trim().slice(0, 64) : '';
    const mode = typeof body.mode === 'string' ? body.mode : '';
    const quantity = Number(body.quantity);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim().slice(0, 32) : '';

    if (!variantId || !ADJUST_MODES.has(mode) || !Number.isInteger(quantity)) {
        return response.status(400).json({ error: 'invalid_request' });
    }

    const result = await adminAdjust({ variantId, mode, quantity, reason, orderNumber, actor: auth.user });
    if (!result.ok) return response.status(409).json(result);

    // Never the reason text or the actor's details — only what changed.
    console.info(`inventory: ${mode} ${variantId} ${quantity} by admin → on_hand ${result.item.onHand}`);
    return response.status(200).json(result);
}

export default async function handler(request, response) {
    if (!ordersConfigured()) {
        response.setHeader('Cache-Control', 'no-store');
        return response.status(503).json({ error: 'inventory_not_configured' });
    }

    const query = request.query || {};
    try {
        if (request.method === 'GET') {
            if (query.scope === 'admin') return await adminRead(request, response);
            if (query.sweep) return await sweep(response);
            return await publicRead(request, response);
        }
        if (request.method === 'POST') return await adminWrite(request, response);

        response.setHeader('Allow', 'GET, POST');
        return response.status(405).json({ error: 'method_not_allowed' });
    } catch (error) {
        console.error(describeSupabaseError(error, 'inventory'));
        response.setHeader('Cache-Control', 'no-store');
        return response.status(500).json({ error: 'inventory_failed' });
    }
}

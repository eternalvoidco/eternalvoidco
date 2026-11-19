// ─────────────────────────────────────────────────────────────────────────────
// GET /api/artist-royalties — the royalty statement. Admin only.
//
//   ?quarter=2026Q4            or ?from=…&to=… (ISO dates, [from, to) )
//   ?artist=name@example.com   one artist rather than all
//   ?format=csv                the itemised lines, for accounting
//
// Reads the orders and refunds the shop already records, scoped to the SKUs a
// signed agreement names in artist_collaborations. A SKU nobody has written
// there earns nothing — so a mistake shows up as a missing payment somebody
// notices, never as a silent overpayment.
//
// THIS DOES NOT PAY ANYBODY. It produces a statement for accounting to check
// and approve. There is no payment path in this file and there should not be
// one: the export is evidence, the payout is a decision.
//
// What it computes is exactly what the public page promises — the amount
// actually paid for the merchandise after discounts, excluding VAT and
// separately charged shipping, less reversals applied once and bucketed on the
// date they happened. Production, sampling, packaging, platform fees, payment
// fees, marketing and overhead appear nowhere in it.
// ─────────────────────────────────────────────────────────────────────────────
import { requireAdmin } from './_auth.js';
import { artistsConfigured, rpc, describeSupabaseError } from './_artists.js';

// 2026Q4 → the quarter as a half-open range in UTC.
function quarterRange(label) {
    const match = /^(\d{4})Q([1-4])$/.exec(String(label || '').trim().toUpperCase());
    if (!match) return null;
    const year = Number(match[1]);
    const q = Number(match[2]);
    const from = new Date(Date.UTC(year, (q - 1) * 3, 1));
    const to = new Date(Date.UTC(q === 4 ? year + 1 : year, q === 4 ? 0 : q * 3, 1));
    return { from, to };
}

function money(minor) {
    return (Number(minor || 0) / 100).toFixed(2);
}

function csv(statement) {
    const rows = [[
        'artist_email', 'order_number', 'paid_at', 'sku', 'product_name',
        'quantity', 'line_amount_eur', 'discount_allocated_eur', 'net_merchandise_eur'
    ].join(',')];

    (statement.lines || []).forEach((l) => {
        rows.push([
            l.artistEmail, l.orderNumber, l.paidAt, l.sku,
            `"${String(l.productName || '').replace(/"/g, '""')}"`,
            l.quantity, money(l.lineAmount), money(l.discountAllocated), money(l.netMerchandise)
        ].join(','));
    });

    rows.push('');
    rows.push(['artist_email', 'order_number', 'sku', 'kind', 'provider_ref', 'refunded_at', 'reversal_eur'].join(','));
    (statement.reversalLines || []).forEach((r) => {
        rows.push([r.artistEmail, r.orderNumber, r.sku, r.kind, r.providerRef, r.refundedAt, money(r.amount)].join(','));
    });

    rows.push('');
    rows.push(['artist_email', 'credit_name', 'agreement_ref', 'units', 'gross_eur',
               'discounts_eur', 'reversals_eur', 'royalty_base_eur', 'rate_pct',
               'royalty_due_eur', 'carry_forward_eur'].join(','));
    (statement.artists || []).forEach((a) => {
        rows.push([
            a.artistEmail, `"${String(a.creditName || '').replace(/"/g, '""')}"`, a.agreementRef,
            a.units, money(a.grossMerchandise), money(a.discounts), money(a.reversals),
            money(a.royaltyBase), (a.royaltyBps / 100).toFixed(2), money(a.royaltyDue),
            money(a.carryForward)
        ].join(','));
    });

    return rows.join('\n');
}

export default async function handler(request, response) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return response.status(gate.status).json({ ok: false, error: gate.error });
    if (!artistsConfigured()) return response.status(503).json({ ok: false, error: 'not_configured' });

    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');

    const url = new URL(request.url, 'http://local');
    let range = quarterRange(url.searchParams.get('quarter'));
    if (!range) {
        const from = new Date(url.searchParams.get('from') || '');
        const to = new Date(url.searchParams.get('to') || '');
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
            return response.status(400).json({ ok: false, error: 'bad_period' });
        }
        range = { from, to };
    }

    const artist = (url.searchParams.get('artist') || '').trim().toLowerCase() || null;

    let statement;
    try {
        statement = await rpc('artist_royalty_statement', {
            p_from: range.from.toISOString(),
            p_to: range.to.toISOString(),
            p_artist_email: artist
        });
    } catch (error) {
        console.error(describeSupabaseError(error, 'artists: royalty statement'));
        return response.status(502).json({ ok: false, error: 'upstream_failed' });
    }

    // Said on every statement, because a number without its basis invites
    // somebody to pay from it.
    statement.basis = {
        royaltyBase: 'amount actually paid for the collaboration merchandise, after discounts',
        excluded: ['VAT and other sales taxes', 'separately charged shipping'],
        notDeducted: ['production', 'sampling', 'packaging', 'platform fees',
                      'payment fees', 'marketing', 'overhead'],
        reversals: 'refunds and chargebacks applied once, partial amounts honoured, bucketed on the date of the reversal',
        scope: 'SKUs named in artist_collaborations, direct channel, within the agreement window',
        approval: 'statement only — accounting approves and executes payment, and confirms invoicing, currency conversion and any withholding'
    };

    if ((url.searchParams.get('format') || '').toLowerCase() === 'csv') {
        const label = url.searchParams.get('quarter')
            || `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename="ev-artists-royalties-${label}.csv"`);
        return response.status(200).send(csv(statement));
    }

    return response.status(200).json(statement);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/artist-royalties — the royalty statement. Admin only.
//
//   ?quarter=2026Q4            or ?from=…&to=… (ISO dates, [from, to) )
//   ?artist=name@example.com   one artist rather than all
//   ?format=csv                the payout file. REFUSED unless the period
//                              reconciles — see below.
//   ?format=csv&diagnostic=1   the same figures with every unresolved item
//                              named, for accounting to investigate with.
//                              Always allowed, and watermarked as not payable.
//
// A PERIOD THAT DOES NOT RECONCILE PRODUCES NO PAYOUT FILE. An unallocated
// reversal, an order whose subtotal disagrees with its lines, a line with no
// SKU, or an over-allocation all block it, because each of them means the
// figure below is not the figure that should be paid. The diagnostic export
// stays open so the blockage can be found and cleared, and says on its face
// that it is not a payment instruction.
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

const quote = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;

function csv(statement, diagnostic) {
    const rows = [];

    // The first thing anybody opening this file reads.
    rows.push(['# EV for Artists royalty statement'].join(','));
    rows.push(['# period_from', statement.period.from].join(','));
    rows.push(['# period_to', statement.period.to].join(','));
    rows.push(['# reconciliation', statement.reconciliation.status].join(','));
    rows.push(['# vat_basis', statement.vatBasis || 'unknown'].join(','));
    rows.push(['# reversal_history_attested',
               (statement.reconciliation.coverage || {}).covered ? 'yes' : 'NO'].join(','));
    rows.push(['# payout_ready', statement.payoutReady ? 'yes' : 'NO'].join(','));
    if ((statement.vatBasis || 'unknown') === 'unknown') {
        rows.push(['# ', quote('VAT BASIS UNRESOLVED. Nobody has recorded whether the charged '
            + 'amounts include VAT. Under a 27% inclusive reading every royalty below is '
            + 'overstated by the whole VAT fraction.')].join(','));
    }
    if (!statement.payoutReady) {
        rows.push(['# ', quote('DIAGNOSTIC ONLY — NOT A PAYMENT INSTRUCTION. '
            + 'This period does not reconcile; the figures below are incomplete. '
            + 'Clear the blocking items listed at the end, then re-run.')].join(','));
    }
    rows.push('');

    rows.push(['artist_email', 'order_number', 'paid_at', 'sku', 'product_name',
               'quantity', 'net_merchandise_eur'].join(','));
    (statement.lines || []).forEach((l) => {
        rows.push([l.artistEmail, l.orderNumber, l.paidAt, l.sku, quote(l.productName),
                   l.quantity, money(l.netMerchandise)].join(','));
    });

    rows.push('');
    rows.push(['artist_email', 'order_number', 'sku', 'kind', 'provider_ref',
               'refunded_at', 'reversal_eur', 'allocation', 'rule'].join(','));
    (statement.reversalLines || []).forEach((r) => {
        rows.push([r.artistEmail, r.orderNumber, r.sku, r.kind, r.providerRef,
                   r.refundedAt, money(r.amount), r.allocation, r.rule || ''].join(','));
    });

    rows.push('');
    // Every documented cost deducted, with the document it came from.
    rows.push(['artist_email', 'sku', 'category', 'basis', 'evidence_ref', 'attributable_on',
               'order_number', 'units', 'unit_cost_eur', 'deduction_eur'].join(','));
    (statement.costLines || []).forEach((k) => {
        rows.push([k.artistEmail, k.sku, k.category, k.basis, quote(k.evidenceRef), k.attributableOn,
                   k.orderNumber || '', k.units == null ? '' : k.units,
                   k.unitAmount == null ? '' : money(k.unitAmount), money(k.amount)].join(','));
    });

    rows.push('');
    // The statement an artist reads: sales, deductions, profit, royalty —
    // with `charged` beside `net_merchandise` so the VAT decision is visible
    // on the face of the file rather than folded into one number.
    const head = ['artist_email', 'credit_name', 'agreement_ref', 'sku', 'rate_pct', 'units',
                  'charged_eur', 'net_merchandise_eur', 'reversals_eur', 'sales_eur',
                  'manufacturing_eur', 'printing_eur', 'packaging_eur', 'payment_processing_eur',
                  'deductions_eur', 'profit_eur', 'carried_in_eur', 'royalty_base_eur',
                  'royalty_due_eur', 'carry_forward_eur', 'costs_attested'];
    rows.push(head.join(','));
    (statement.artists || []).forEach((a) => {
        (a.perSku || []).forEach((s) => {
            const c = s.deductionsByCategory || {};
            rows.push([a.artistEmail, quote(a.creditName), a.agreementRef, s.sku,
                       (s.royaltyBps / 100).toFixed(2), s.units, money(s.grossCharged),
                       money(s.grossMerchandise), money(s.reversals), money(s.sales),
                       money(c.manufacturing), money(c.printing), money(c.packaging),
                       money(c.paymentProcessing), money(s.deductions), money(s.profit),
                       money(s.carriedIn), money(s.royaltyBase), money(s.royaltyDue),
                       money(s.carryForward), s.costsAttested ? 'yes' : 'NO'].join(','));
        });
        rows.push([a.artistEmail, quote(a.creditName), a.agreementRef, 'TOTAL', '',
                   a.units, money(a.grossCharged), money(a.grossMerchandise),
                   money(a.reversals), money(a.sales), '', '', '', '', money(a.deductions),
                   money(a.profit), money(a.carriedIn), money(a.royaltyBase),
                   money(a.royaltyDue), money(a.carryForward), a.costsAttested ? 'yes' : 'NO'].join(','));
    });

    // What is in the way, named, so the file is also the worklist.
    if (!statement.payoutReady || diagnostic) {
        const b = statement.reconciliation.blocking;
        const r = statement.reconciliation.review;
        rows.push('');
        rows.push(['# unresolved — each of these blocks a payout'].join(','));
        rows.push(['issue', 'reference', 'order_number', 'amount_eur', 'detail'].join(','));
        (b.vatBasisUnresolved || []).forEach((v) => {
            rows.push(['vat_basis_unresolved', '', v.order_number, '',
                       quote('nobody has recorded whether the charged amount includes VAT'
                             + (v.country ? ` (ships to ${v.country})` : ''))].join(','));
        });
        (statement.costsUnattested || []).forEach((code) => {
            rows.push(['costs_not_attested', code, '', '',
                       quote('nobody has attested that this design\'s documented costs for the whole period are recorded')].join(','));
        });
        (b.currencyNotEur || []).forEach((c) => {
            rows.push(['currency_not_eur', '', c.order_number, '', quote(c.currency)].join(','));
        });
        if (b.reversalHistoryNotAttested) {
            rows.push(['reversal_history_not_attested', '', '', '',
                       quote('no dry run has established that this window\'s refunds and disputes '
                             + 'were read back from Stripe; gap from '
                             + b.reversalHistoryNotAttested.gapFrom + ' to '
                             + b.reversalHistoryNotAttested.gapTo)].join(','));
        }
        (b.unallocatedReversals || []).forEach((u) => {
            rows.push(['unallocated_reversal', u.provider_ref, u.order_number,
                       money(u.amount), quote(u.allocation_note)].join(','));
        });
        (b.discountAnomalies || []).forEach((d) => {
            rows.push(['subtotal_disagrees_with_lines', '', d.order_number, money(d.lines_total),
                       quote(`subtotal ${money(d.subtotal_amount)} vs lines ${money(d.lines_total)}`)].join(','));
        });
        (b.linesWithoutSku || []).forEach((o) => {
            rows.push(['line_without_sku', '', o, '', quote('cannot be matched to an agreement')].join(','));
        });
        (b.overAllocated || []).forEach((v) => {
            rows.push(['over_allocated', v.provider_ref, '', money(v.amount),
                       quote(`allocated ${money(v.allocated)}`)].join(','));
        });
        (r.pendingReversals || []).forEach((p) => {
            rows.push(['pending_reversal', p.provider_ref, p.order_number, money(p.amount),
                       quote('status not final')].join(','));
        });
        (r.refundAndDisputeOnSameCharge || []).forEach((x) => {
            rows.push(['refund_and_dispute_same_charge', x.charge_id, x.order_number, '',
                       quote(`refunded ${money(x.refunded || 0)}, disputed ${money(x.disputed || 0)}`)].join(','));
        });
    }

    return rows.join('\n');
}

export default async function handler(request, response) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return response.status(gate.status).json({ ok: false, error: gate.error });
    if (!artistsConfigured()) return response.status(503).json({ ok: false, error: 'not_configured' });

    // ── accounting's two decisions, and the ledger ──────────────────────────
    // POST { action: 'vatBasis', basis, note }
    //      { action: 'raiseCarry',   quarter | from,to }   close a period
    //      { action: 'consumeCarry', quarter | from,to }   mark a payout made
    //
    // raiseCarry and consumeCarry are each idempotent by a database
    // constraint, not by a check here, so a retried request cannot double a
    // balance however it arrives.
    if (request.method === 'POST') {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const action = String(body.action || '');

        if (action === 'vatBasis') {
            const basis = String(body.basis || '');
            try {
                const out = await rpc('artist_royalty_set_vat_basis', {
                    p_basis: basis, p_actor: gate.user.email,
                    p_note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null
                }, 'set vat basis');
                if (!out || !out.ok) return response.status(400).json(out || { ok: false });
                return response.status(200).json(out);
            } catch (error) {
                console.error(describeSupabaseError(error, 'royalties: vat basis'));
                return response.status(502).json({ ok: false, error: 'upstream_failed' });
            }
        }

        if (action === 'raiseCarry' || action === 'consumeCarry') {
            let range = quarterRange(body.quarter);
            if (!range) {
                const from = new Date(body.from || '');
                const to = new Date(body.to || '');
                if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
                    return response.status(400).json({ ok: false, error: 'bad_period' });
                }
                range = { from, to };
            }
            const fn = action === 'raiseCarry'
                ? 'artist_royalty_raise_carry' : 'artist_royalty_consume_carry';
            try {
                const out = await rpc(fn, {
                    p_from: range.from.toISOString(),
                    p_to: range.to.toISOString(),
                    p_actor: gate.user.email
                }, action);
                return response.status(200).json(out);
            } catch (error) {
                console.error(describeSupabaseError(error, `royalties: ${action}`));
                return response.status(502).json({ ok: false, error: 'upstream_failed' });
            }
        }

        // { action: 'recordCost', sku, category, basis, amountMinor, from, to?, evidenceRef, note? }
        // { action: 'attestCosts', sku?, quarter | from,to, note? }
        // Recording refuses a duplicate document, an overlapping per-unit
        // rate and any category ETERNAL VOID bears itself, in the database.
        if (action === 'recordCost') {
            try {
                const out = await rpc('artist_royalty_cost_record', {
                    p_sku: String(body.sku || ''), p_category: String(body.category || ''),
                    p_basis: String(body.basis || ''), p_amount: Number.parseInt(body.amountMinor, 10),
                    p_applies_from: String(body.from || ''), p_applies_to: body.to ? String(body.to) : null,
                    p_evidence_ref: String(body.evidenceRef || ''), p_actor: gate.user.email,
                    p_note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null
                }, 'record cost');
                return response.status(out && out.ok ? 200 : 400).json(out || { ok: false });
            } catch (error) {
                console.error(describeSupabaseError(error, 'royalties: record cost'));
                return response.status(502).json({ ok: false, error: 'upstream_failed' });
            }
        }
        if (action === 'attestCosts') {
            let range = quarterRange(body.quarter);
            if (!range) {
                const from = new Date(body.from || '');
                const to = new Date(body.to || '');
                if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
                    return response.status(400).json({ ok: false, error: 'bad_period' });
                }
                range = { from, to };
            }
            try {
                const out = await rpc('artist_royalty_costs_attest', {
                    p_sku: body.sku ? String(body.sku) : null,
                    p_from: range.from.toISOString(), p_to: range.to.toISOString(),
                    p_actor: gate.user.email,
                    p_note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null
                }, 'attest costs');
                return response.status(out && out.ok ? 200 : 400).json(out || { ok: false });
            } catch (error) {
                console.error(describeSupabaseError(error, 'royalties: attest costs'));
                return response.status(502).json({ ok: false, error: 'upstream_failed' });
            }
        }

        return response.status(400).json({ ok: false, error: 'unknown_action' });
    }

    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET, POST');
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
        royalty: 'royalty_bps (12% proposed) of the net profit from sales of the artist\'s specific design (SKU)',
        sales: 'the amount actually paid for the design after discounts — sum(order_items.line_amount), which in this codebase IS orders.subtotal_amount — net of VAT under the recorded basis, less refunds and chargebacks',
        excluded: ['VAT and other sales taxes (orders.tax_amount)', 'separately charged shipping (orders.shipping_amount)'],
        deducted: ['documented manufacturing, printing, packaging and payment-processing costs attributable to the units sold, each counted once'],
        notDeducted: ['sampling', 'marketing', 'general overhead — ETERNAL VOID bears these'],
        carry: 'when reversals and deductions exceed sales, the excess is carried forward once against the same design\'s next period',
        reversals: 'refunds and chargebacks counted once through their allocation rows, only where the money actually moved, bucketed on the date it moved; a dispute won is reinstated and does not reduce a royalty',
        scope: 'SKUs named in artist_collaborations, direct channel, within the agreement window',
        approval: 'statement only — accounting approves and executes payment, and confirms invoicing, currency conversion and any withholding'
    };

    const diagnostic = url.searchParams.get('diagnostic') === '1';

    if ((url.searchParams.get('format') || '').toLowerCase() === 'csv') {
        // A payout file for a period that does not reconcile is the one thing
        // this endpoint must never hand over. The diagnostic version of the
        // same period stays available so the blockage can be cleared.
        if (!statement.payoutReady && !diagnostic) {
            return response.status(409).json({
                ok: false,
                error: 'period_not_reconciled',
                status: statement.reconciliation.status,
                blockingCount: statement.reconciliation.blockingCount,
                reviewCount: statement.reconciliation.reviewCount,
                blocking: statement.reconciliation.blocking,
                review: statement.reconciliation.review,
                message: 'This period does not reconcile, so no payout file is produced. '
                    + 'Add &diagnostic=1 for the same figures with every unresolved item named.'
            });
        }

        const label = url.searchParams.get('quarter')
            || `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;
        const name = statement.payoutReady
            ? `ev-artists-royalties-${label}.csv`
            : `ev-artists-royalties-${label}-DIAGNOSTIC-DO-NOT-PAY.csv`;
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        return response.status(200).send(csv(statement, diagnostic));
    }

    return response.status(200).json(statement);
}

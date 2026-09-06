// ─────────────────────────────────────────────────────────────────────────────
// The authoritative catalogue.
//
// This project has no product database — the boutique is a static document and
// the cart in the browser is just localStorage. So this module is the server's
// source of truth for what a piece is, what it costs and which sizes it is cut
// in. Nothing a client sends about price, currency or availability is ever
// believed; the client may only name a variant and a quantity.
//
// A variant id is `<product-slug>:<size>`. It is stable, human-auditable and
// derived from data that already exists in index.html, so there is no second
// place for a price to drift.
//
// When a real products table lands, replace lookupVariant() with a query and
// nothing else in the checkout has to change.
// ─────────────────────────────────────────────────────────────────────────────

export const CURRENCY = 'eur';

// Amounts are in minor units (cents), which is what Stripe expects and what
// avoids float arithmetic on money.
const TEE_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const SET_SIZES = ['S', 'M', 'L', 'XL'];

const PRODUCTS = {
    'levitate-tee': {
        name: 'Levitate Tee',
        sku: 'EV-S1-LVT',
        unitAmount: 20000,
        sizes: TEE_SIZES,
        image: '/assets/levitate-white.png',
        active: true
    },
    'endzustand-tee': {
        name: 'Endzustand Tee',
        sku: 'EV-S1-END',
        unitAmount: 20000,
        sizes: TEE_SIZES,
        image: '/assets/endzustand-black.png',
        active: true
    },
    'insigne-ivoire': {
        name: 'Insigne Ivoire',
        sku: 'EV-S1-OGW',
        unitAmount: 25000,
        sizes: TEE_SIZES,
        image: '/assets/ivory-gold-monogram.png',
        active: true
    },
    'insigne-noir': {
        name: 'Insigne Noir',
        sku: 'EV-S1-OGB',
        unitAmount: 25000,
        sizes: TEE_SIZES,
        image: '/assets/ivory-black-gold-monogram.png',
        active: true
    },
    'insigne-azure': {
        name: 'Insigne Azure',
        sku: 'EV-S1-OBW',
        unitAmount: 25000,
        sizes: TEE_SIZES,
        image: '/assets/ivory-blue-monogram.png',
        active: true
    },

    // Not sellable. These three carry data-price-pending in the boutique
    // because no price exists for them anywhere in the project, and one is not
    // invented here. `active: false` makes the checkout refuse them rather than
    // charging a placeholder figure.
    'sweatshirt': {
        name: 'Sweatshirt',
        sku: null,
        unitAmount: null,
        sizes: SET_SIZES,
        image: '/assets/SWEATSHIRT/eternalvoid-sweatshirt-front-back.png',
        active: false
    },
    'track-pants': {
        name: 'Track Pants',
        sku: null,
        unitAmount: null,
        sizes: SET_SIZES,
        image: '/assets/TRACKPANTS/eternalvoid-trackpants-front-back.png',
        active: false
    },
    'ensemble': {
        name: 'Ensemble',
        sku: null,
        unitAmount: null,
        sizes: SET_SIZES,
        image: '/assets/ENSEMBLES/eternalvoid-ensembles-front-back.png',
        active: false
    }
};

// The cart stores display names, so the server has to be able to get from a
// name back to a slug. Built once, not on every request.
const SLUG_BY_NAME = new Map(
    Object.entries(PRODUCTS).map(([slug, product]) => [product.name.toLowerCase(), slug])
);

export function slugForName(name) {
    if (typeof name !== 'string') return null;
    return SLUG_BY_NAME.get(name.trim().toLowerCase()) || null;
}

export function variantId(slug, size) {
    return `${slug}:${String(size).toUpperCase()}`;
}

// The single validation gate. Returns either a resolved line or a reason the
// line cannot be sold — never a partially trusted object.
export function lookupVariant(id) {
    if (typeof id !== 'string' || id.indexOf(':') === -1) {
        return { ok: false, reason: 'unknown_variant' };
    }

    const [slug, rawSize] = id.split(':');
    const product = PRODUCTS[slug];
    if (!product) return { ok: false, reason: 'unknown_variant' };

    const size = String(rawSize || '').toUpperCase();
    if (!product.sizes.includes(size)) {
        return { ok: false, reason: 'unknown_size', name: product.name, size };
    }

    if (!product.active || product.unitAmount == null) {
        return { ok: false, reason: 'not_for_sale', name: product.name, size };
    }

    return {
        ok: true,
        variantId: variantId(slug, size),
        slug,
        name: product.name,
        sku: product.sku,
        size,
        unitAmount: product.unitAmount,
        currency: CURRENCY,
        image: product.image
    };
}

// ── Stock ────────────────────────────────────────────────────────────────────
// No inventory exists anywhere in this project: there is no stock column, no
// warehouse feed and no reservation model. Rather than pretend, this returns
// `null` meaning "not tracked", and the checkout treats every active variant as
// available. When a stock source appears, return a number here and
// validateLines() will start enforcing it with no other changes.
export function stockFor() {
    return null;
}

export const MAX_QTY_PER_LINE = 10;

// ── Shipping ─────────────────────────────────────────────────────────────────
// Rates are read from the environment, never hardcoded, because no shipping
// prices exist in this project and inventing them would put a fake number on a
// real invoice. Amounts are minor units.
//
//   VOID_SHIP_HU_STANDARD, VOID_SHIP_HU_EXPRESS
//   VOID_SHIP_EU_STANDARD, VOID_SHIP_EU_EXPRESS
//   VOID_SHIP_INTL_STANDARD
//
// A zone with no configured rate is simply not offered. If nothing is
// configured the checkout says so plainly instead of shipping for free.
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

export function zoneForCountry(code) {
    const cc = String(code || '').toUpperCase();
    if (cc === 'HU') return 'HU';
    if (EU.has(cc)) return 'EU';
    return 'INTL';
}

function rate(name) {
    const raw = process.env[name];
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
}

const SHIPPING_METHODS = [
    { id: 'hu-standard', zone: 'HU', env: 'VOID_SHIP_HU_STANDARD', label: 'Standard', note: 'Hungary' },
    { id: 'hu-express', zone: 'HU', env: 'VOID_SHIP_HU_EXPRESS', label: 'Express', note: 'Hungary' },
    { id: 'eu-standard', zone: 'EU', env: 'VOID_SHIP_EU_STANDARD', label: 'Standard', note: 'European Union' },
    { id: 'eu-express', zone: 'EU', env: 'VOID_SHIP_EU_EXPRESS', label: 'Express', note: 'European Union' },
    { id: 'intl-standard', zone: 'INTL', env: 'VOID_SHIP_INTL_STANDARD', label: 'Standard', note: 'International' }
];

export function shippingMethodsFor(country) {
    const zone = zoneForCountry(country);
    return SHIPPING_METHODS
        .filter((method) => method.zone === zone)
        .map((method) => ({ id: method.id, label: method.label, note: method.note, amount: rate(method.env) }))
        .filter((method) => method.amount != null);
}

export function shippingAmountFor(country, methodId) {
    const method = shippingMethodsFor(country).find((m) => m.id === methodId);
    return method ? method.amount : null;
}

// ── Tax ──────────────────────────────────────────────────────────────────────
// No tax model exists in this project and product prices carry no stated tax
// treatment, so nothing is computed. The order schema keeps a tax_amount column
// and this stays at zero until a real model is configured — a guessed VAT rate
// on a real invoice is worse than none.
export function taxAmountFor() {
    return 0;
}

// ── Line validation ──────────────────────────────────────────────────────────
// The one place a payable figure is produced. Callers pass only ids and
// quantities; everything else is read from the catalogue above.
export function validateLines(rawLines) {
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
        return { ok: false, error: 'empty_cart', lines: [], issues: [] };
    }
    if (rawLines.length > 20) {
        return { ok: false, error: 'too_many_lines', lines: [], issues: [] };
    }

    const lines = [];
    const issues = [];

    for (const raw of rawLines) {
        const id = raw && typeof raw.variantId === 'string' ? raw.variantId : '';
        const qty = Number(raw && raw.quantity);

        if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
            issues.push({ variantId: id, reason: 'invalid_quantity' });
            continue;
        }

        const found = lookupVariant(id);
        if (!found.ok) {
            issues.push({ variantId: id, reason: found.reason, name: found.name, size: found.size });
            continue;
        }

        const stock = stockFor(found.variantId);
        if (stock != null && qty > stock) {
            issues.push({ variantId: id, reason: 'insufficient_stock', name: found.name, size: found.size, available: stock });
            continue;
        }

        lines.push({
            variantId: found.variantId,
            slug: found.slug,
            name: found.name,
            sku: found.sku,
            size: found.size,
            image: found.image,
            quantity: qty,
            unitAmount: found.unitAmount,
            lineAmount: found.unitAmount * qty
        });
    }

    if (issues.length > 0) return { ok: false, error: 'line_issues', lines, issues };
    if (lines.length === 0) return { ok: false, error: 'empty_cart', lines, issues };

    return { ok: true, lines, issues };
}

export function subtotalOf(lines) {
    return lines.reduce((sum, line) => sum + line.lineAmount, 0);
}

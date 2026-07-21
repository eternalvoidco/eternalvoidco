// ─────────────────────────────────────────────────────────────────────────────
// THE VOID CONCIERGE — BRAND KNOWLEDGE BASE  (edit this file to update answers)
//
// This is the single source of truth the concierge (OBSIDIAN) answers from.
// You do NOT need to touch any other file to change what it knows.
//
// HOW IT WORKS — the "data-status" model
//   Every fact is either:
//     • a real value   → the concierge answers it precisely (VERIFIED)
//     • the string ''   or null  → NOT CONFIRMED. The concierge will NOT invent
//                                  it. It says so honestly and routes the guest
//                                  to the pre-order form / support email.
//   So: fill a field in → it becomes a confirmed answer. Leave it null → the
//   concierge stays honest about not knowing it. It never guesses prices,
//   shipping fees, delivery times, countries, sizing numbers, stock, or dates.
//
// TO EDIT: change the values below. Keep the shape (keys) the same.
//   - A price / fee / date you can confirm  → type it in.
//   - Something not decided yet             → leave it as null (or '').
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
    // ── Identity & contact ─────────────────────────────────────────────
    brand: {
        name: 'VOID',                         // shown to guests as "VOID" / "Eternal Void"
        legalName: 'Eternal Void',
        domain: 'eternalvoid.co',
        positioning: 'A luxury monochrome streetwear atelier — limited, considered, permanent.'
    },
    contact: {
        supportEmail: 'support@eternalvoid.co',   // VERIFIED
        preorderForm: 'the pre-order form on eternalvoid.co',  // VERIFIED
        phone: null,          // e.g. '+1 ...'  — leave null if none
        hours: null,          // e.g. 'Mon–Fri, 9–18 CET' — leave null if unknown
        instagram: null       // e.g. '@eternalvoid.co'
    },

    // ── Products & collection ──────────────────────────────────────────
    collection: {
        name: 'Season One',                                              // VERIFIED
        summary: 'A limited run of oversized VOID essentials — heavyweight cotton tees cut with an intentional oversized architecture, in monochrome and oblique-signature colourways.', // VERIFIED
        colourways: 'Monochrome and oblique-signature colourways.',      // VERIFIED (general)
        // List each named product once you want the concierge to reference it by
        // name. Leave [] if you don't want it naming specific SKUs yet.
        products: [
            // { name: 'The VOID Tee', type: 'Oversized heavyweight cotton T-shirt', price: null, sizes: ['S','M','L','XL'] }
        ]
    },

    // ── Pricing ────────────────────────────────────────────────────────
    // Leave null until prices are public. The concierge will NOT quote a price
    // it hasn't been given.
    pricing: {
        currency: null,      // e.g. 'EUR', 'USD'
        teePrice: null,      // e.g. '€120' or '120'
        priceRange: null,    // e.g. '€90–€160'
        notes: null          // e.g. 'Prices exclude duties/taxes outside the EU.'
    },

    // ── Availability ───────────────────────────────────────────────────
    availability: {
        releaseModel: 'Released as limited pre-order drops.',  // VERIFIED (general)
        launchDate: null,     // e.g. 'September 2026' — leave null if not announced
        inStock: null,        // e.g. 'By pre-order only' — leave null if unknown
        stockNotes: null
    },

    // ── Materials & construction ───────────────────────────────────────
    materials: {
        fabric: 'Heavyweight cotton with a dense, substantial hand-feel, finished for depth and permanence.', // VERIFIED
        weightGsm: null,      // e.g. '240 gsm' — leave null if not measured
        construction: null,   // e.g. 'Double-stitched, tubular knit, made in Portugal'
        care: 'Machine wash cold at 30°C, inside out. No bleach, no tumble dry. Iron inside out at a low temperature.' // VERIFIED
    },

    // ── Size guide / fit ───────────────────────────────────────────────
    sizeGuide: {
        philosophy: 'Cut with an intentional oversized architecture, measured against an oversized baseline fit.', // VERIFIED
        fitAdvice: 'For a cleaner, closer silhouette, size down one. For the fullest oversized look, keep your usual size.', // VERIFIED
        referTo: 'the on-site Size Guide for exact measurements in centimetres.', // VERIFIED
        // Optional precise chart — fill to let the concierge give exact numbers.
        // Example row: { size: 'M', chestCm: 60, lengthCm: 74, fitsHeightCm: '175–185' }
        measurements: []
    },

    // ── Pre-order process ──────────────────────────────────────────────
    preorder: {
        how: 'Reserve through the pre-order form on eternalvoid.co for early access and priority updates before a drop opens.', // VERIFIED
        benefits: 'Early access, priority notifications, and first choice of sizes.', // VERIFIED (general)
        paymentTiming: null,  // e.g. 'Charged at reservation' / 'Charged when it ships'
        chargeNotes: null
    },

    // ── Shipping ───────────────────────────────────────────────────────
    // The big one for real questions. Fill these in as they are confirmed.
    shipping: {
        // General, already true today:
        general: 'Delivery is tracked worldwide once a pre-order ships.', // VERIFIED (general)
        // Specific facts — leave null until confirmed:
        shipsToCountries: null,   // e.g. 'EU, UK, US, Canada, Australia' or a full list
        excludedCountries: null,  // e.g. 'We currently cannot ship to ...'
        carriers: null,           // e.g. 'DHL Express, UPS'
        timeframes: null,         // e.g. '3–6 business days within the EU, 5–10 worldwide'
        freeShippingThreshold: null, // e.g. 'Free over €200'
        // Fees: leave null for "confirmed at checkout by the team", OR provide a
        // table so the concierge can quote exact prices. Example:
        // fees: [ { region: 'Germany', fee: '€8' }, { region: 'Rest of EU', fee: '€12' } ]
        fees: null,
        feesNote: 'Shipping cost depends on destination and final order details, confirmed before the order is placed.' // used when fees are null
    },

    // ── Returns & exchanges ────────────────────────────────────────────
    returns: {
        window: '14 days',                                   // VERIFIED
        policy: 'Free returns and exchanges within 14 days.', // VERIFIED
        exclusions: 'Personalised items are excluded.',       // VERIFIED
        whoPaysReturn: null,   // e.g. 'We provide a prepaid label' — leave null if unsure
        condition: null        // e.g. 'Unworn, tags attached'
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Builder — turns the data above into a clean brief for the system prompt.
// Fields left null/'' are surfaced as "NOT CONFIRMED" so the model stays honest.
// You normally do NOT need to edit below this line.
// ─────────────────────────────────────────────────────────────────────────────
const MISSING = 'NOT CONFIRMED — do not state; direct the guest to the pre-order form or support email.';

function val(v, fallback = MISSING) {
    if (v === null || v === undefined || v === '') return fallback;
    return v;
}

function feesBlock(shipping) {
    if (Array.isArray(shipping.fees) && shipping.fees.length) {
        const rows = shipping.fees.map((f) => `    • ${f.region}: ${f.fee}`).join('\n');
        return `Shipping fees (VERIFIED — quote these exactly):\n${rows}`;
    }
    return `Shipping fees: NOT CONFIRMED. ${shipping.feesNote} Ask for the guest's country and city/postcode if missing, then say the VOID team will confirm the exact fee before the order is placed. Never invent a number.`;
}

function productsBlock(collection) {
    if (Array.isArray(collection.products) && collection.products.length) {
        return collection.products.map((p) => {
            const price = p.price ? ` — ${p.price}` : '';
            const sizes = p.sizes && p.sizes.length ? ` (sizes: ${p.sizes.join(', ')})` : '';
            return `    • ${p.name}: ${p.type || ''}${price}${sizes}`;
        }).join('\n');
    }
    return '    • Named products not configured — describe the collection generally, do not invent product names.';
}

function measurementsBlock(sizeGuide) {
    if (Array.isArray(sizeGuide.measurements) && sizeGuide.measurements.length) {
        const rows = sizeGuide.measurements
            .map((m) => `    • ${m.size}: chest ${m.chestCm}cm, length ${m.lengthCm}cm${m.fitsHeightCm ? `, suits ${m.fitsHeightCm}cm` : ''}`)
            .join('\n');
        return `Exact measurements (VERIFIED — quote these):\n${rows}`;
    }
    return `Exact measurements: NOT CONFIRMED here. Give fit guidance from the philosophy above and refer the guest to ${sizeGuide.referTo}`;
}

export function buildBrandContext() {
    const b = BRAND;
    return `=== VOID BRAND DATA (answer only from this) ===

BRAND
- ${b.brand.name} (${b.brand.legalName}), ${b.brand.domain}. ${b.brand.positioning}

CONTACT (VERIFIED)
- Email: ${val(b.contact.supportEmail)}
- Pre-order: ${val(b.contact.preorderForm)}
- Phone: ${val(b.contact.phone)}
- Hours: ${val(b.contact.hours)}

COLLECTION & PRODUCTS
- Collection: ${val(b.collection.name)}. ${val(b.collection.summary)}
- Colourways: ${val(b.collection.colourways)}
- Products:
${productsBlock(b.collection)}

PRICING
- Currency: ${val(b.pricing.currency)}
- Tee price: ${val(b.pricing.teePrice)}
- Range: ${val(b.pricing.priceRange)}
- Notes: ${val(b.pricing.notes)}

AVAILABILITY
- Model: ${val(b.availability.releaseModel)}
- Launch date: ${val(b.availability.launchDate)}
- In stock: ${val(b.availability.inStock)}

MATERIALS & CARE
- Fabric: ${val(b.materials.fabric)}
- Weight: ${val(b.materials.weightGsm)}
- Construction: ${val(b.materials.construction)}
- Care: ${val(b.materials.care)}

SIZE & FIT
- Philosophy: ${val(b.sizeGuide.philosophy)}
- Fit advice: ${val(b.sizeGuide.fitAdvice)}
- ${measurementsBlock(b.sizeGuide)}

PRE-ORDER
- How: ${val(b.preorder.how)}
- Benefits: ${val(b.preorder.benefits)}
- Payment timing: ${val(b.preorder.paymentTiming)}

SHIPPING
- General: ${val(b.shipping.general)}
- Ships to: ${val(b.shipping.shipsToCountries)}
- Excluded: ${val(b.shipping.excludedCountries)}
- Carriers: ${val(b.shipping.carriers)}
- Delivery timeframes: ${val(b.shipping.timeframes)}
- Free shipping: ${val(b.shipping.freeShippingThreshold)}
- ${feesBlock(b.shipping)}

RETURNS & EXCHANGES
- Window: ${val(b.returns.window)}
- Policy: ${val(b.returns.policy)}
- Exclusions: ${val(b.returns.exclusions)}
- Return shipping: ${val(b.returns.whoPaysReturn)}
- Condition: ${val(b.returns.condition)}`;
}

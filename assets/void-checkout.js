// ─────────────────────────────────────────────────────────────────────────────
// ETERNAL VOID — checkout controller
//
// State lives in one object. The browser holds a bag and a form; it never holds
// an authoritative price. Every figure shown here came back from
// /api/checkout/quote, and the amount actually charged is fixed server-side by
// /api/checkout/create. Nothing on this page can change what is billed.
// ─────────────────────────────────────────────────────────────────────────────

const CART_KEY = 'voidCart';
const PROGRESS_KEY = 'void-checkout-progress';   // contact + address only, never payment
const STAGES = ['details', 'delivery', 'payment'];

// Matches the catalogue slugs in api/_catalog.js. The bag stores display names
// (it predates variants), so this is the bridge until products live in a table.
const SLUGS = {
    'levitate tee': 'levitate-tee',
    'endzustand tee': 'endzustand-tee',
    'insigne ivoire': 'insigne-ivoire',
    'insigne noir': 'insigne-noir',
    'insigne azure': 'insigne-azure',
    sweatshirt: 'sweatshirt',
    'track pants': 'track-pants',
    ensemble: 'ensemble'
};

const COUNTRIES = [
    ['HU', 'Hungary'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['HR', 'Croatia'],
    ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'],
    ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['IE', 'Ireland'], ['IT', 'Italy'],
    ['LV', 'Latvia'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MT', 'Malta'], ['NL', 'Netherlands'],
    ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SK', 'Slovakia'], ['SI', 'Slovenia'],
    ['ES', 'Spain'], ['SE', 'Sweden'],
    ['GB', 'United Kingdom'], ['CH', 'Switzerland'], ['NO', 'Norway'], ['RS', 'Serbia'], ['UA', 'Ukraine'],
    ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'], ['JP', 'Japan']
];

const $ = (id) => document.getElementById(id);
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
    cart: [],
    quote: null,
    stage: 'details',
    details: { email: '', firstName: '', lastName: '', phone: '' },
    address: { shipFirstName: '', shipLastName: '', line1: '', line2: '', postalCode: '', city: '', country: '' },
    shippingMethodId: '',
    billingSameAsShipping: true,
    order: null,
    stripe: null,
    elements: null,
    busy: false
};

// ── money ────────────────────────────────────────────────────────────────────
const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' });
const money = (minor) => (minor == null ? '—' : fmt.format(minor / 100));

// ── bag ──────────────────────────────────────────────────────────────────────
function readCart() {
    try {
        const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item) => item && typeof item.name === 'string' && typeof item.size === 'string'
                && Number.isInteger(item.quantity) && item.quantity > 0)
            .map((item) => {
                const slug = SLUGS[item.name.trim().toLowerCase()];
                return slug ? { ...item, variantId: `${slug}:${item.size.toUpperCase()}` } : null;
            })
            .filter(Boolean);
    } catch (error) {
        return [];
    }
}

function writeCart(cart) {
    try {
        // Store in the boutique's own shape; variantId is a checkout concern.
        localStorage.setItem(CART_KEY, JSON.stringify(cart.map(({ variantId, ...rest }) => rest)));
    } catch (error) { /* private mode: session-only */ }
}

// ── saved progress ───────────────────────────────────────────────────────────
// Contact details and an address, so a refresh is not punishing. Never a card,
// never a client secret, never a total.
function saveProgress() {
    try {
        sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({
            details: state.details,
            address: state.address,
            shippingMethodId: state.shippingMethodId
        }));
    } catch (error) { /* ignore */ }
}

function loadProgress() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) || 'null');
        if (!saved) return;
        Object.assign(state.details, saved.details || {});
        Object.assign(state.address, saved.address || {});
        state.shippingMethodId = saved.shippingMethodId || '';
    } catch (error) { /* ignore */ }
}

// ── stage choreography ───────────────────────────────────────────────────────
function stageEl(name) { return document.querySelector(`.ck-stage[data-stage="${name}"]`); }

function setStage(name, { instant = false } = {}) {
    if (!STAGES.includes(name) || name === state.stage) return;

    const from = stageEl(state.stage);
    const to = stageEl(name);
    state.stage = name;
    markProgress();

    if (instant || reduced()) {
        if (from) from.classList.remove('is-active', 'is-entering', 'is-leaving');
        to.classList.add('is-active');
        to.focus?.();
        return;
    }

    from.classList.add('is-leaving');
    window.setTimeout(() => {
        from.classList.remove('is-active', 'is-leaving');
        to.classList.remove('is-leaving');
        to.classList.add('is-active', 'is-entering');
        // The rule draws, then the section is set behind it.
        to.querySelector('.ck-stage-title')?.focus?.();
        window.setTimeout(() => to.classList.remove('is-entering'), 620);
    }, 240);

    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
}

function markProgress() {
    const order = [...STAGES, 'confirmation'];
    const current = order.indexOf(state.stage);
    document.querySelectorAll('.ck-step').forEach((step) => {
        const index = order.indexOf(step.dataset.step);
        if (index < current) step.dataset.state = 'done';
        else if (index === current) step.dataset.state = 'active';
        else step.removeAttribute('data-state');
    });
}

// ── validation ───────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setFieldError(field, message) {
    const wrap = document.querySelector(`[data-field="${field}"]`);
    if (!wrap) return;
    wrap.classList.toggle('is-invalid', Boolean(message));
    const input = wrap.querySelector('.ck-input, .ck-select');
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    const err = wrap.querySelector('.ck-error');
    if (err) err.textContent = message || '';
}

function clearErrors(form) {
    form.querySelectorAll('[data-field]').forEach((wrap) => setFieldError(wrap.dataset.field, ''));
}

function validateDetails() {
    clearErrors($('formDetails'));
    let firstBad = null;
    const fail = (field, message) => { setFieldError(field, message); firstBad = firstBad || field; };

    if (!EMAIL_RE.test(state.details.email)) fail('email', 'Enter a valid email address.');
    if (!state.details.firstName) fail('firstName', 'Required.');
    if (!state.details.lastName) fail('lastName', 'Required.');

    if (firstBad) document.querySelector(`[data-field="${firstBad}"] .ck-input`)?.focus();
    return !firstBad;
}

function validateDelivery() {
    clearErrors($('formDelivery'));
    let firstBad = null;
    const fail = (field, message) => { setFieldError(field, message); firstBad = firstBad || field; };

    if (!state.address.shipFirstName) fail('shipFirstName', 'Required.');
    if (!state.address.shipLastName) fail('shipLastName', 'Required.');
    if (!state.address.line1) fail('line1', 'Required.');
    if (!state.address.postalCode) fail('postalCode', 'Required.');
    if (!state.address.city) fail('city', 'Required.');
    if (!state.address.country) fail('country', 'Select a destination.');

    if (!firstBad && !state.shippingMethodId) {
        showBlocker('Delivery', 'Select a delivery method to continue.', true);
        return false;
    }

    if (firstBad) {
        document.querySelector(`[data-field="${firstBad}"] .ck-input, [data-field="${firstBad}"] .ck-select`)?.focus();
    }
    return !firstBad;
}

// ── notices ──────────────────────────────────────────────────────────────────
function showBlocker(title, body, neutral = false) {
    const el = $('ckBlocker');
    el.classList.toggle('is-neutral', neutral);
    $('ckBlockerTitle').textContent = title;
    $('ckBlockerBody').textContent = body;
    el.hidden = false;
}

function hideBlocker() { $('ckBlocker').hidden = true; }

const ISSUE_COPY = {
    not_for_sale: (i) => `${i.name || 'This piece'} is not yet available for purchase.`,
    unknown_variant: () => 'One of the pieces in your bag is no longer in the collection.',
    unknown_size: (i) => `${i.name || 'This piece'} is no longer cut in size ${i.size}.`,
    insufficient_stock: (i) => `Only ${i.available} of ${i.name} remain in size ${i.size}.`,
    invalid_quantity: () => 'One of the quantities in your bag is not valid.'
};

function describeIssues(issues) {
    return issues.map((issue) => (ISSUE_COPY[issue.reason] || (() => 'This selection is no longer available.'))(issue)).join(' ');
}

// ── quote ────────────────────────────────────────────────────────────────────
async function refreshQuote() {
    const payload = {
        items: state.cart.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        country: state.address.country || undefined,
        shippingMethodId: state.shippingMethodId || undefined
    };

    let data;
    try {
        const res = await fetch('/api/checkout/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        data = await res.json();
    } catch (error) {
        showBlocker('Connection', 'We could not reach the atelier. Check your connection and try again.');
        return null;
    }

    if (!data.ok) {
        if (data.error === 'empty_cart') { setCartState('empty'); return null; }
        showBlocker('Selection unavailable', describeIssues(data.issues || []));
        state.quote = null;
        renderSummary();
        return null;
    }

    hideBlocker();
    state.quote = data;
    renderSummary();
    renderMethods();
    return data;
}

// ── rendering ────────────────────────────────────────────────────────────────
// The one place cart state becomes visible. 'loading' shows neither branch, so
// the empty state can never appear before the bag has actually been read.
function setCartState(next) {
    document.getElementById('ckShell').dataset.cart = next;
}

function renderSummary() {
    const lines = (state.quote && state.quote.lines) || [];
    const list = $('ckLines');
    list.textContent = '';

    lines.forEach((line) => {
        const li = document.createElement('li');
        li.className = 'ck-line';

        const media = document.createElement('div');
        media.className = 'ck-line-media';
        const img = document.createElement('img');
        img.src = line.image;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        media.appendChild(img);

        const info = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'ck-line-name';
        name.textContent = line.name;
        const meta = document.createElement('span');
        meta.className = 'ck-line-meta';
        meta.textContent = `Size ${line.size}`;
        info.append(name, meta, quantityControl(line));

        const price = document.createElement('span');
        price.className = 'ck-line-price';
        price.textContent = money(line.lineAmount);

        li.append(media, info, price);
        list.appendChild(li);
    });

    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    $('ckSummaryCount').textContent = count === 1 ? '1 piece' : `${count} pieces`;

    const q = state.quote;
    $('ckSubtotal').textContent = q ? money(q.subtotalAmount) : '—';
    $('ckShipping').textContent = q && q.shippingAmount != null ? money(q.shippingAmount) : '—';
    $('ckTotal').textContent = q ? money(q.totalAmount) : '—';
    $('ckSummaryTotalMini').textContent = q ? money(q.totalAmount) : 'Summary';

    // Tax is only ever shown when a real model produces one. There is none yet,
    // so no line is drawn rather than an authoritative-looking zero.
    $('ckSummaryNote').textContent = q && q.shippingAmount == null
        ? 'Delivery is calculated once a destination is chosen.'
        : 'Totals are confirmed by our server before payment.';
}

function quantityControl(line) {
    const wrap = document.createElement('span');
    wrap.className = 'ck-qty';

    const make = (label, delta, disabled) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.disabled = Boolean(disabled) || state.busy;
        btn.setAttribute('aria-label', `${delta > 0 ? 'Increase' : 'Decrease'} quantity of ${line.name}, size ${line.size}`);
        btn.addEventListener('click', () => changeQuantity(line.variantId, delta));
        return btn;
    };

    const value = document.createElement('span');
    value.textContent = String(line.quantity);
    value.setAttribute('aria-live', 'polite');

    wrap.append(make('−', -1, line.quantity <= 1), value, make('+', 1, line.quantity >= 10));
    return wrap;
}

async function changeQuantity(variantId, delta) {
    const item = state.cart.find((line) => line.variantId === variantId);
    if (!item) return;

    const next = item.quantity + delta;
    if (next < 1 || next > 10) return;
    item.quantity = next;
    writeCart(state.cart);

    // A quantity change invalidates any intent already opened for the old
    // total, so payment is rebuilt when the customer returns to it.
    resetPayment();
    await refreshQuote();
}

function renderMethods() {
    const wrap = $('ckMethods');
    const note = $('ckMethodsNote');
    wrap.textContent = '';

    if (!state.address.country) {
        note.textContent = 'Choose a country to see delivery options.';
        return;
    }

    const methods = (state.quote && state.quote.shippingMethods) || [];
    if (methods.length === 0) {
        note.textContent = 'Delivery rates for this destination are not configured yet. Please contact an advisor to complete this order.';
        return;
    }

    note.textContent = '';
    methods.forEach((method) => {
        const label = document.createElement('label');
        label.className = 'ck-method';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'shippingMethod';
        input.value = method.id;
        input.checked = state.shippingMethodId === method.id;
        input.addEventListener('change', async () => {
            state.shippingMethodId = method.id;
            saveProgress();
            resetPayment();
            await refreshQuote();
        });

        const mark = document.createElement('span');
        mark.className = 'ck-method-mark';
        mark.setAttribute('aria-hidden', 'true');

        const body = document.createElement('span');
        const name = document.createElement('span');
        name.className = 'ck-method-name';
        name.textContent = method.label;
        const sub = document.createElement('span');
        sub.className = 'ck-method-note';
        sub.textContent = method.note;
        body.append(name, sub);

        const price = document.createElement('span');
        price.className = 'ck-method-price';
        price.textContent = money(method.amount);

        label.append(input, mark, body, price);
        wrap.appendChild(label);
    });

    // Pre-select when there is only one way to send it.
    if (!state.shippingMethodId && methods.length === 1) {
        state.shippingMethodId = methods[0].id;
        wrap.querySelector('input').checked = true;
        refreshQuote();
    }
}

// ── payment ──────────────────────────────────────────────────────────────────
function resetPayment() {
    state.order = null;
    state.elements = null;
    $('ckPaymentElement').textContent = '';
    $('ckExpress').hidden = true;
    $('ckPayError').hidden = true;
}

// Stripe's supported appearance API. The iframe is never touched directly.
function appearance() {
    return {
        theme: 'night',
        variables: {
            colorPrimary: '#c7a96c',
            colorBackground: '#050505',
            colorText: '#f5f2ec',
            colorTextSecondary: 'rgba(245,242,236,0.44)',
            colorTextPlaceholder: 'rgba(245,242,236,0.26)',
            colorDanger: '#d99a86',
            fontFamily: 'Jost, system-ui, sans-serif',
            fontSizeBase: '15px',
            spacingUnit: '4px',
            borderRadius: '2px'
        },
        rules: {
            '.Input': {
                backgroundColor: 'transparent',
                border: '0',
                borderBottom: '1px solid rgba(245,242,236,0.1)',
                borderRadius: '0',
                boxShadow: 'none',
                padding: '10px 0'
            },
            '.Input:focus': { borderBottom: '1px solid rgba(199,169,108,0.65)', boxShadow: 'none' },
            '.Input--invalid': { borderBottom: '1px solid rgba(217,154,134,0.7)', boxShadow: 'none' },
            '.Label': {
                fontSize: '9px',
                fontWeight: '500',
                letterSpacing: '0.26em',
                textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.44)'
            },
            '.Tab': {
                backgroundColor: 'transparent',
                border: '1px solid rgba(245,242,236,0.1)',
                borderRadius: '2px'
            },
            '.Tab--selected': { borderColor: 'rgba(199,169,108,0.55)', color: '#f5f2ec' },
            '.Error': { fontSize: '11px', letterSpacing: '0.06em' }
        }
    };
}

async function preparePayment() {
    if (state.order) return true;

    setBusy(true, $('ckPayButton'));
    $('ckPayError').hidden = true;

    let token = null;
    try {
        // If the visitor is signed in, the token proves it. The server resolves
        // the identity itself; we never send a user id.
        const mod = await import('/assets/supabase-client.js');
        const session = await mod.getSession();
        token = session ? session.access_token : null;
    } catch (error) { /* guest checkout */ }

    let data;
    try {
        const res = await fetch('/api/checkout/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                items: state.cart.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
                email: state.details.email,
                firstName: state.details.firstName,
                lastName: state.details.lastName,
                phone: state.details.phone,
                shippingMethodId: state.shippingMethodId,
                billingSameAsShipping: state.billingSameAsShipping,
                shippingAddress: {
                    firstName: state.address.shipFirstName,
                    lastName: state.address.shipLastName,
                    line1: state.address.line1,
                    line2: state.address.line2,
                    city: state.address.city,
                    postalCode: state.address.postalCode,
                    country: state.address.country,
                    phone: state.details.phone
                }
            })
        });
        data = await res.json();
        if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'create_failed'), { data });
    } catch (error) {
        setBusy(false, $('ckPayButton'));
        const code = error.data?.error || error.message;
        if (code === 'stripe_not_configured' || code === 'orders_not_configured') {
            showBlocker('Checkout unavailable', 'Payments are not configured on this environment yet.');
        } else if (code === 'shipping_unavailable' || code === 'invalid_shipping_method') {
            setStage('delivery');
            showBlocker('Delivery', 'That delivery method is no longer available. Please choose another.');
        } else if (error.data?.issues) {
            showBlocker('Selection unavailable', describeIssues(error.data.issues));
        } else {
            showBlocker('Checkout', 'We could not start this payment. Please try again.');
        }
        return false;
    }

    state.order = data;

    // The server's figure is the one shown from here on. If it moved, say so
    // before anything is charged.
    const previous = state.quote && state.quote.totalAmount;
    state.quote = { ...state.quote, ...data };
    renderSummary();
    if (previous != null && previous !== data.totalAmount) {
        showBlocker('Total updated', `Your total is now ${money(data.totalAmount)}. Review it before completing the order.`, true);
    }

    if (!state.stripe) {
        // Same public-config endpoint the rest of the site already uses; the
        // publishable key is the only Stripe value that ever reaches a browser.
        let publishableKey = '';
        try {
            const cfg = await (await fetch('/api/config', { cache: 'no-store' })).json();
            publishableKey = cfg.stripePublishableKey || '';
        } catch (error) { /* handled below */ }

        if (!publishableKey || typeof window.Stripe !== 'function') {
            setBusy(false, $('ckPayButton'));
            showBlocker('Checkout unavailable', 'The payment provider could not be loaded.');
            return false;
        }
        state.stripe = window.Stripe(publishableKey);
    }

    state.elements = state.stripe.elements({ clientSecret: data.clientSecret, appearance: appearance() });
    state.elements.create('payment', { layout: 'tabs' }).mount('#ckPaymentElement');

    // Wallets are offered only if Stripe reports one is actually usable.
    try {
        const express = state.elements.create('expressCheckout');
        express.on('ready', (event) => {
            if (event && event.availablePaymentMethods) $('ckExpress').hidden = false;
        });
        express.on('confirm', () => confirmPayment());
        express.mount('#ckExpressElement');
    } catch (error) { /* express unavailable in this Stripe.js build */ }

    setBusy(false, $('ckPayButton'));
    return true;
}

function setBusy(busy, button) {
    state.busy = busy;
    if (button) {
        button.disabled = busy;
        button.classList.toggle('is-busy', busy);
    }
    document.querySelectorAll('.ck-cta').forEach((cta) => { if (cta !== button) cta.disabled = busy; });
    $('ckProcessing').hidden = !busy || state.stage !== 'payment';
}

async function confirmPayment() {
    if (!state.stripe || !state.elements || !state.order || state.busy) return;

    setBusy(true, $('ckPayButton'));
    $('ckPayError').hidden = true;

    const returnUrl = new URL('/checkout/success', window.location.origin);
    returnUrl.searchParams.set('order', state.order.orderNumber);
    returnUrl.searchParams.set('email', state.details.email);

    // Stripe owns any 3-D Secure step; `if_required` keeps the customer here
    // when no authentication is needed and redirects when it is.
    const { error, paymentIntent } = await state.stripe.confirmPayment({
        elements: state.elements,
        confirmParams: { return_url: returnUrl.toString() },
        redirect: 'if_required'
    });

    if (error) {
        setBusy(false, $('ckPayButton'));
        $('ckPayErrorBody').textContent = error.message
            || 'Your selection is unchanged. Please review your payment method and try again.';
        $('ckPayError').hidden = false;
        $('ckPayError').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
        return;
    }

    // Succeeded or is processing. Either way the webhook is what confirms it;
    // the success page reads the recorded state rather than assuming.
    if (paymentIntent && ['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status)) {
        clearPurchasedItems();
        window.location.assign(returnUrl.toString());
    } else {
        setBusy(false, $('ckPayButton'));
        $('ckPayErrorBody').textContent = 'The payment was not completed. Your selection is unchanged.';
        $('ckPayError').hidden = false;
    }
}

// Only after a payment has actually been submitted successfully — never on
// arriving at checkout, never on a failed attempt.
function clearPurchasedItems() {
    try {
        localStorage.removeItem(CART_KEY);
        sessionStorage.removeItem(PROGRESS_KEY);
    } catch (error) { /* ignore */ }
}

// ── wiring ───────────────────────────────────────────────────────────────────
function bindField(id, target, key) {
    const input = $(id);
    if (!input) return;
    input.value = target[key] || '';
    input.addEventListener('input', () => {
        target[key] = input.value.trim();
        setFieldError(input.closest('[data-field]')?.dataset.field, '');
        saveProgress();
    });
}

function buildCountries() {
    const select = $('ckCountry');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select a country';
    select.appendChild(blank);

    COUNTRIES.forEach(([code, name]) => {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        select.appendChild(option);
    });

    select.value = state.address.country || '';
    select.addEventListener('change', async () => {
        state.address.country = select.value;
        state.shippingMethodId = '';
        setFieldError('country', '');
        saveProgress();
        resetPayment();
        await refreshQuote();
    });
}

async function init() {
    loadProgress();

    // Reading the bag is synchronous localStorage, so this resolves in the same
    // task the module starts in — the shell goes straight from loading to its
    // real state without an intermediate paint.
    state.cart = readCart();

    if (state.cart.length === 0) { setCartState('empty'); return; }
    setCartState('ready');

    bindField('ckEmail', state.details, 'email');
    bindField('ckFirstName', state.details, 'firstName');
    bindField('ckLastName', state.details, 'lastName');
    bindField('ckPhone', state.details, 'phone');
    bindField('ckShipFirstName', state.address, 'shipFirstName');
    bindField('ckShipLastName', state.address, 'shipLastName');
    bindField('ckLine1', state.address, 'line1');
    bindField('ckLine2', state.address, 'line2');
    bindField('ckPostal', state.address, 'postalCode');
    bindField('ckCity', state.address, 'city');
    buildCountries();

    $('ckBillingSame').addEventListener('change', (event) => {
        state.billingSameAsShipping = event.target.checked;
    });

    document.querySelectorAll('[data-advance]').forEach((button) => {
        button.addEventListener('click', async () => {
            const next = button.dataset.advance;
            if (next === 'delivery') {
                if (!validateDetails()) return;
                // Carry the name across rather than making them type it twice.
                if (!state.address.shipFirstName) {
                    state.address.shipFirstName = state.details.firstName;
                    $('ckShipFirstName').value = state.details.firstName;
                }
                if (!state.address.shipLastName) {
                    state.address.shipLastName = state.details.lastName;
                    $('ckShipLastName').value = state.details.lastName;
                }
                saveProgress();
                setStage('delivery');
                return;
            }

            if (next === 'payment') {
                if (!validateDelivery()) return;
                setBusy(true, button);
                const quote = await refreshQuote();
                setBusy(false, button);
                if (!quote) return;
                setStage('payment');
                await preparePayment();
            }
        });
    });

    document.querySelectorAll('[data-back]').forEach((button) => {
        button.addEventListener('click', () => setStage(button.dataset.back));
    });

    $('ckPayButton').addEventListener('click', () => confirmPayment());

    const toggle = $('ckSummaryToggle');
    toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        $('ckSummaryBody').hidden = open;
    });
    // Collapsed to start on narrow viewports only.
    if (window.matchMedia('(max-width: 900px)').matches) $('ckSummaryBody').hidden = true;

    markProgress();
    await refreshQuote();
}

init();

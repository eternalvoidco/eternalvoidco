import './styles.css';

const emblemUrl = '/media/ev-emblem.png';
const campaignUrl = '/media/enter-the-void.mp4';
const campaignPoster = '/media/hero-void.png';

const products = [
  {
    id: 'levitate',
    name: 'Levitate Tee',
    price: 250,
    fit: 'Oversized ritual fit',
    description: 'A weightless ritual tee in heavyweight cotton. Dropped shoulder, sculpted volume and a dense hand-feel engineered for layered VOID styling.',
    color: 'Obsidian / Bone',
    material: '420 GSM cotton',
    edition: 'Edition 01 / 40',
    tone: 'smoke'
  },
  {
    id: 'endzustand',
    name: 'Endzustand Tee',
    price: 250,
    fit: 'Boxy oversized fit',
    description: 'Structured through the chest with a blunt hem and controlled volume. A severe silhouette softened by garment-washed cotton.',
    color: 'Void black',
    material: '460 GSM cotton',
    edition: 'Edition 02 / 40',
    tone: 'graphite'
  },
  {
    id: 'oblique-gold-white',
    name: 'Oblique Gold / White',
    price: 200,
    fit: 'Relaxed oversized fit',
    description: 'A clean oversized cut with fluid body width and an understated gold oblique signature across a mineral-white base.',
    color: 'Gold / Mineral',
    material: '380 GSM cotton',
    edition: 'Edition 03 / 60',
    tone: 'ivory'
  },
  {
    id: 'oblique-gold-black',
    name: 'Oblique Gold / Black',
    price: 200,
    fit: 'Relaxed oversized fit',
    description: 'Gold-on-black oblique signature for a restrained monochrome contrast. Cut wide and finished with a substantial collar.',
    color: 'Gold / Obsidian',
    material: '380 GSM cotton',
    edition: 'Edition 04 / 60',
    tone: 'noir'
  },
  {
    id: 'oblique-blue-white',
    name: 'Oblique Blue / White',
    price: 200,
    fit: 'Relaxed oversized fit',
    description: 'A cooler register in the Season One line, cut for an architectural drape with a washed-blue oblique signature.',
    color: 'Cobalt / Mineral',
    material: '380 GSM cotton',
    edition: 'Edition 05 / 60',
    tone: 'cobalt'
  }
];

const storage = {
  read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
};

function routeFromHash() {
  const route = location.hash.replace(/^#\/?/, '');
  if (route.startsWith('product/')) {
    const product = products.find((item) => item.id === route.split('/')[1]);
    return { screen: 'detail', product: product || products[0] };
  }
  const screen = ['home', 'shop', 'saved', 'join', 'profile'].includes(route) ? route : 'home';
  return { screen, product: products[0] };
}

const initialRoute = routeFromHash();
const savedCart = storage.read('void-mobile-cart', []);
const savedWishlist = storage.read('void-mobile-wishlist', []);
const savedJoinState = storage.read('void-mobile-joined', false);

const state = {
  screen: initialRoute.screen,
  selectedProduct: initialRoute.product,
  selectedSize: 'M',
  cart: Array.isArray(savedCart) ? savedCart : [],
  wishlist: Array.isArray(savedWishlist) ? savedWishlist : [],
  joined: savedJoinState === true || savedJoinState === 1 || savedJoinState === '1',
  bagOpen: false
};

const icons = {
  home: '<path d="M4 11.1 12 4l8 7.1v8.4h-5v-5.2H9v5.2H4z"/>',
  shop: '<path d="M5 8.5h14l-1 11H6zM8.4 8.5V7a3.6 3.6 0 0 1 7.2 0v1.5"/>',
  heart: '<path d="M20.2 9c0 5.3-8.2 10-8.2 10S3.8 14.3 3.8 9a4.2 4.2 0 0 1 7.3-2.8L12 7.3l.9-1.1A4.2 4.2 0 0 1 20.2 9Z"/>',
  bag: '<path d="M5 8.5h14l-1 11H6zM8.4 8.5V7a3.6 3.6 0 0 1 7.2 0v1.5"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5.4 20c.5-3.5 3-5.5 6.6-5.5s6.1 2 6.6 5.5"/>',
  arrow: '<path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  delivery: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  garment: '<path d="m8 4-5 3 3 4 2-1v10h8V10l2 1 3-4-5-3c-.6 1.3-1.9 2-4 2S8.6 5.3 8 4Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'
};

const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const money = (value) => new Intl.NumberFormat('en-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const cartCount = () => state.cart.reduce((sum, item) => sum + item.quantity, 0);
const isSaved = (id) => state.wishlist.includes(id);

function persist() {
  const cart = state.cart.map((item) => ({ id: item.id || item.product?.id, size: item.size, quantity: item.quantity }));
  storage.write('void-mobile-cart', cart);
  storage.write('void-mobile-wishlist', state.wishlist);
}

function normalizedCart() {
  return state.cart.map((item) => ({
    ...item,
    id: item.id || item.product?.id,
    product: products.find((product) => product.id === (item.id || item.product?.id)) || item.product
  })).filter((item) => item.product);
}

state.cart = normalizedCart();

function ambientLayer() {
  return '<div class="ambient" aria-hidden="true"><span class="ambient-orb ambient-orb-one"></span><span class="ambient-orb ambient-orb-two"></span><span class="ambient-line"></span><span class="global-grain"></span></div>';
}

function topbar({ back = false, transparent = false } = {}) {
  return `<header class="topbar ${transparent ? 'topbar-transparent' : ''}">
    <div class="topbar-side">${back ? `<button class="icon-button" data-action="back" aria-label="Go back">${icon('back')}</button>` : '<span class="edition-mark">EV / 01</span>'}</div>
    <button class="wordmark" data-nav="home" aria-label="Eternal Void home"><span>ETERNAL</span><strong>VOID</strong><i>©</i></button>
    <div class="topbar-side topbar-end"><button class="bag-button" data-action="bag" aria-label="Open shopping bag">${icon('bag')}<span class="bag-count">${cartCount()}</span></button></div>
  </header>`;
}

function orbitalEmblem(size = 'large') {
  return `<div class="orbital-emblem orbital-${size}" aria-hidden="true">
    <span class="aura aura-one"></span><span class="aura aura-two"></span>
    <span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="orbit orbit-three"></span>
    <span class="orbit-node"></span>
    <img src="${emblemUrl}" alt="" />
  </div>`;
}

function productVisual(product, variant = 'card') {
  return `<div class="product-visual product-visual-${variant}">
    <span class="visual-glow" aria-hidden="true"></span>
    <span class="visual-mark" aria-hidden="true">${product.name.charAt(0)}</span>
    <span class="product-grain" aria-hidden="true"></span>
    <span class="product-index">${product.edition}</span>
  </div>`;
}

function goldButton(label, attrs = '', trailing = icon('arrow'), extraClass = '') {
  return `<button class="gold-button ${extraClass}" ${attrs}><span class="button-sheen"></span><span class="button-label">${label}</span>${trailing}</button>`;
}

function home() {
  return `${topbar({ transparent: true })}
  <main class="screen home-screen">
    <section class="hero-card" data-parallax>
      <video class="hero-video" autoplay muted loop playsinline poster="${campaignPoster}" aria-hidden="true"><source src="${campaignUrl}" type="video/mp4"></video>
      <span class="hero-vignette"></span><span class="hero-spotlight"></span><span class="hero-grid"></span><span class="hero-grain"></span>
      <div class="hero-meta reveal reveal-one"><p>ETERNAL VOID</p><span>SEASON 01 · MMXXVI</span></div>
      ${orbitalEmblem('large')}
      <div class="hero-copy">
        <p class="eyebrow reveal reveal-two">Limited objects for the present</p>
        <h1 class="reveal reveal-three">Built for<br><em>presence.</em></h1>
        <p class="hero-description reveal reveal-four">A study in controlled volume, ritual black and the quiet weight of arrival.</p>
        ${goldButton('Enter Season One', 'data-nav="shop"', icon('arrow'), 'reveal reveal-five')}
      </div>
      <div class="hero-foot reveal reveal-five"><span>Scroll to discover</span><i></i><span>01 / 05</span></div>
    </section>

    <section class="manifesto editorial-section">
      <div class="section-number">01</div>
      <p class="eyebrow">The first expression</p>
      <h2>Not made to be noticed.<br><em>Made to be remembered.</em></h2>
      <p class="manifesto-copy">Every silhouette is reduced to its essential gesture. Weight, fall, negative space and the mark.</p>
    </section>

    <section class="featured-section">
      <div class="section-head"><div><p class="eyebrow">Season One</p><h2>Selected objects</h2></div><button class="text-link" data-nav="shop">View all ${icon('arrow')}</button></div>
      <div class="product-rail">${products.slice(0, 3).map((product, index) => `
        <article class="rail-card" style="--card-delay:${index * 90}ms">
          <button class="product-open" data-product="${product.id}" aria-label="View ${product.name}">${productVisual(product, 'rail')}</button>
          <div class="rail-copy"><div><span>${product.name}</span><small>${product.color}</small></div><strong>${money(product.price)}</strong></div>
        </article>`).join('')}</div>
    </section>

    <section class="access-banner shimmer-border">
      <span class="access-noise"></span>
      <div><p class="eyebrow">Private access</p><h2>The next door opens quietly.</h2><p>Pre-order windows, atelier notes and first access to every limited release.</p></div>
      ${goldButton(state.joined ? 'Access reserved' : 'Request invitation', 'data-nav="join"', state.joined ? icon('check') : icon('arrow'), 'button-compact')}
    </section>
  </main>`;
}

function shop() {
  return `${topbar()}
  <main class="screen shop-screen">
    <section class="collection-intro">
      <div class="collection-orbit" aria-hidden="true"></div>
      <p class="eyebrow reveal reveal-one">Collection · 01</p>
      <h1 class="reveal reveal-two">Season<br><em>One.</em></h1>
      <div class="collection-meta reveal reveal-three"><p>Five limited silhouettes developed as objects of presence, not seasonal product.</p><span>MMXXVI<br>Paris / Berlin</span></div>
    </section>
    <div class="collection-toolbar reveal reveal-four"><span>All objects</span><i></i><span>05 pieces</span><i></i><span>Release 01</span></div>
    <section class="product-grid">${products.map((product, index) => `
      <article class="product-card" style="--card-delay:${index * 75}ms">
        <button class="wish-toggle ${isSaved(product.id) ? 'active' : ''}" data-wish="${product.id}" aria-label="${isSaved(product.id) ? 'Remove' : 'Save'} ${product.name}" aria-pressed="${isSaved(product.id)}">${icon('heart')}</button>
        <button class="product-open" data-product="${product.id}" aria-label="View ${product.name}">${productVisual(product)}</button>
        <button class="product-card-copy" data-product="${product.id}"><span class="product-card-title"><strong>${product.name}</strong><small>${product.color}</small></span><span class="product-card-price">${money(product.price)}</span><span class="product-card-arrow">${icon('arrow')}</span></button>
      </article>`).join('')}</section>
  </main>`;
}

function detail() {
  const product = state.selectedProduct;
  return `${topbar({ back: true, transparent: true })}
  <main class="screen detail-screen">
    <section class="detail-stage">
      <div class="detail-stage-meta reveal reveal-one"><span>${product.edition}</span><span>${product.color}</span></div>
      ${productVisual(product, 'detail')}
      <button class="wish-toggle detail-wish ${isSaved(product.id) ? 'active' : ''}" data-wish="${product.id}" aria-label="${isSaved(product.id) ? 'Remove' : 'Save'} ${product.name}" aria-pressed="${isSaved(product.id)}">${icon('heart')}</button>
      <div class="gallery-dots" aria-hidden="true"><i class="active"></i><i></i><i></i></div>
    </section>
    <section class="detail-content">
      <p class="eyebrow reveal reveal-one">${product.material}</p>
      <div class="detail-title reveal reveal-two"><h1>${product.name}</h1><strong>${money(product.price)}</strong></div>
      <p class="detail-description reveal reveal-three">${product.description}</p>
      <div class="detail-divider"></div>
      <section class="size-block reveal reveal-four">
        <div class="size-heading"><div><p class="eyebrow">Select size</p><strong>${state.selectedSize} · ${product.fit}</strong></div><button class="text-link" data-action="size-guide">Size guide</button></div>
        <div class="size-row">${['XS', 'S', 'M', 'L', 'XL'].map((size) => `<button class="size ${state.selectedSize === size ? 'active' : ''}" data-size="${size}" aria-pressed="${state.selectedSize === size}">${size}</button>`).join('')}</div>
      </section>
      ${goldButton(`Add ${state.selectedSize} to bag`, 'data-action="add"', `<span>${money(product.price)}</span>`, 'add-button reveal reveal-five')}
      <div class="service-row reveal reveal-five"><span>${icon('garment')}<small>Atelier finish</small></span><span>${icon('delivery')}<small>Tracked worldwide</small></span><span>${icon('lock')}<small>Secure checkout</small></span></div>
      <details class="detail-accordion"><summary>Composition & care <span>+</span></summary><p>Heavyweight combed cotton. Wash cold inside out. Dry flat. Each piece is individually finished and may show subtle variations.</p></details>
      <details class="detail-accordion"><summary>Delivery & returns <span>+</span></summary><p>Complimentary tracked delivery. Returns accepted within 14 days in original condition.</p></details>
    </section>
  </main>`;
}

function join() {
  return `${topbar()}
  <main class="screen join-screen">
    <section class="join-hero">
      <span class="join-spotlight"></span><span class="join-grid"></span>
      ${orbitalEmblem('medium')}
      <div class="join-copy">
        <p class="eyebrow reveal reveal-one">Private access · Season One</p>
        <h1 class="reveal reveal-two">Reserve your<br><em>place.</em></h1>
        <p class="reveal reveal-three">The quiet notes before every release. Invitation windows, atelier fragments and first access.</p>
      </div>
    </section>
    ${state.joined ? `<section class="join-success shimmer-border reveal reveal-four">${icon('check')}<p class="eyebrow">Access reserved</p><h2>You are inside.</h2><p>We will write when the next door opens.</p><span>VOID / PRIVATE LIST / 01</span></section>` : `
      <form id="join-form" class="join-form reveal reveal-four">
        <label><span>Email address</span><input type="email" name="email" placeholder="you@example.com" required autocomplete="email"></label>
        <label><span>Country / region</span><input type="text" name="country" placeholder="Your location" required autocomplete="country-name"></label>
        ${goldButton('Request private access', 'type="submit"', icon('arrow'))}
        <small>${icon('lock')} Your details remain private. Phase One stores access status on this device.</small>
      </form>`}
    <section class="access-pillars"><div><span>01</span><p>Private release windows</p></div><div><span>02</span><p>Atelier notes</p></div><div><span>03</span><p>Limited invitations</p></div></section>
  </main>`;
}

function wishlist() {
  const savedProducts = products.filter((product) => isSaved(product.id));
  return `${topbar()}
  <main class="screen saved-screen">
    <section class="saved-heading"><p class="eyebrow reveal reveal-one">Private archive</p><h1 class="reveal reveal-two">Saved<br><em>objects.</em></h1><p class="reveal reveal-three">${savedProducts.length ? `${savedProducts.length} piece${savedProducts.length === 1 ? '' : 's'} held for your return.` : 'Pieces marked for the next release will live here.'}</p></section>
    ${savedProducts.length ? `<section class="saved-list">${savedProducts.map((product, index) => `<article class="saved-item" style="--card-delay:${index * 80}ms"><button data-product="${product.id}">${productVisual(product, 'saved')}</button><div><p>${product.name}</p><span>${product.color}</span><strong>${money(product.price)}</strong></div><button class="saved-remove" data-wish="${product.id}" aria-label="Remove ${product.name}">${icon('close')}</button></article>`).join('')}</section>` : `<button class="empty-state shimmer-border" data-nav="shop">${orbitalEmblem('small')}<strong>The archive is quiet.</strong><span>Discover Season One ${icon('arrow')}</span></button>`}
  </main>`;
}

function profile() {
  return `${topbar()}
  <main class="screen profile-screen">
    <section class="profile-hero">
      <span class="profile-aura"></span>
      <div class="member-monogram reveal reveal-one">V<span></span></div>
      <p class="eyebrow reveal reveal-two">Member space</p><h1 class="reveal reveal-three">Your<br><em>world.</em></h1>
      <p class="reveal reveal-four">Access, objects and orders held in one private place.</p>
    </section>
    <section class="member-card shimmer-border reveal reveal-four"><span class="member-card-light"></span><div><p>ETERNAL VOID</p><small>PRIVATE MEMBER / 01</small></div><strong>${state.joined ? 'ACCESS RESERVED' : 'ACCESS PENDING'}</strong><span class="member-code">EV — 2601</span>${orbitalEmblem('card')}</section>
    <section class="profile-list reveal reveal-five">
      <button disabled aria-disabled="true"><span>${icon('bag')}<i>Orders<small>No orders yet</small></i></span><small class="phase-label">Phase Two</small></button>
      <button data-nav="saved"><span>${icon('heart')}<i>Saved objects<small>${state.wishlist.length} in your archive</small></i></span>${icon('arrow')}</button>
      <button data-nav="join"><span>${icon('compass')}<i>Private access<small>${state.joined ? 'Reserved' : 'Request invitation'}</small></i></span>${icon('arrow')}</button>
      <button disabled aria-disabled="true"><span>${icon('user')}<i>Account settings<small>Coming in Phase Two</small></i></span><small class="phase-label">Phase Two</small></button>
    </section>
  </main>`;
}

function bottomNav() {
  const items = [['home', 'home', 'Home'], ['shop', 'shop', 'Shop'], ['saved', 'heart', 'Saved'], ['join', 'plus', 'Access'], ['profile', 'user', 'Profile']];
  return `<nav class="bottom-nav" aria-label="Primary navigation">${items.map(([screen, glyph, label]) => {
    const active = state.screen === screen || (state.screen === 'detail' && screen === 'shop');
    return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${screen}" aria-current="${active ? 'page' : 'false'}"><span class="nav-glyph">${icon(glyph)}</span><span>${label}</span>${active ? '<i></i>' : ''}</button>`;
  }).join('')}</nav>`;
}

function bag() {
  if (!state.bagOpen) return '';
  const total = state.cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  return `<div class="bag-backdrop" data-action="close-bag"></div><aside class="bag-sheet" role="dialog" aria-modal="true" aria-label="Shopping bag">
    <div class="sheet-handle"></div>
    <header><div><p class="eyebrow">Your selection</p><h2>Shopping bag</h2></div><button class="icon-button" data-action="close-bag" aria-label="Close shopping bag">${icon('close')}</button></header>
    ${state.cart.length ? `<div class="bag-lines">${state.cart.map((item, index) => `<article><div class="bag-thumb">${productVisual(item.product, 'bag')}</div><div class="bag-line-copy"><strong>${item.product.name}</strong><span>${item.size} · ${item.product.color}</span><small>${money(item.product.price)}</small><div class="quantity"><button data-quantity="${index}:minus" aria-label="Decrease quantity">${icon('minus')}</button><b>${item.quantity}</b><button data-quantity="${index}:plus" aria-label="Increase quantity">${icon('plus')}</button></div></div></article>`).join('')}</div><footer><div><span>Subtotal</span><strong>${money(total)}</strong></div><p>Complimentary tracked delivery included.</p>${goldButton('Continue to checkout', 'data-action="checkout"', icon('arrow'))}</footer>` : `<div class="bag-empty">${orbitalEmblem('small')}<strong>Your bag is empty.</strong><p>Add a Season One object when you are ready.</p><button class="text-link" data-nav="shop">Explore the collection ${icon('arrow')}</button></div>`}
  </aside>`;
}

function render(animate = true) {
  const views = { home, shop, detail, join, profile, saved: wishlist };
  const app = document.getElementById('app');
  app.innerHTML = `${ambientLayer()}<div class="app-frame ${animate ? '' : 'motion-static'}">${views[state.screen]()}${bottomNav()}${bag()}<div class="toast" id="toast" role="status" aria-live="polite"></div></div>`;
  document.body.classList.toggle('sheet-open', state.bagOpen);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('video').forEach((video) => video.pause());
}

let toastTimer;
function toast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  clearTimeout(toastTimer);
  node.textContent = message;
  requestAnimationFrame(() => node.classList.add('show'));
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

function navigate(screen, product = null) {
  state.bagOpen = false;
  if (product) {
    state.selectedProduct = product;
    location.hash = `product/${product.id}`;
  } else {
    location.hash = screen === 'home' ? 'home' : screen;
  }
}

document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    navigate(nav.dataset.nav);
    return;
  }

  const productButton = event.target.closest('[data-product]');
  if (productButton) {
    const product = products.find((item) => item.id === productButton.dataset.product);
    if (product) navigate('detail', product);
    return;
  }

  const wish = event.target.closest('[data-wish]');
  if (wish) {
    const id = wish.dataset.wish;
    state.wishlist = isSaved(id) ? state.wishlist.filter((item) => item !== id) : [...state.wishlist, id];
    persist();
    const message = isSaved(id) ? 'Saved to your private archive' : 'Removed from your archive';
    render(false);
    toast(message);
    return;
  }

  const size = event.target.closest('[data-size]');
  if (size) {
    state.selectedSize = size.dataset.size;
    render(false);
    return;
  }

  const quantity = event.target.closest('[data-quantity]');
  if (quantity) {
    const [index, operation] = quantity.dataset.quantity.split(':');
    const item = state.cart[Number(index)];
    if (!item) return;
    item.quantity += operation === 'plus' ? 1 : -1;
    state.cart = state.cart.filter((line) => line.quantity > 0);
    persist();
    render(false);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (!action) return;
  if (action.dataset.action === 'back') history.length > 1 ? history.back() : navigate('shop');
  if (action.dataset.action === 'bag') { state.bagOpen = true; render(false); }
  if (action.dataset.action === 'close-bag') { state.bagOpen = false; render(false); }
  if (action.dataset.action === 'add') {
    const existing = state.cart.find((item) => item.product.id === state.selectedProduct.id && item.size === state.selectedSize);
    if (existing) existing.quantity += 1;
    else state.cart.push({ id: state.selectedProduct.id, product: state.selectedProduct, size: state.selectedSize, quantity: 1 });
    persist();
    state.bagOpen = true;
    render(false);
  }
  if (action.dataset.action === 'size-guide') toast('Oversized by design. Size down for a closer silhouette.');
  if (action.dataset.action === 'checkout') toast('Secure Shopify checkout arrives in Phase Two.');
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'join-form') return;
  event.preventDefault();
  state.joined = true;
  storage.write('void-mobile-joined', true);
  render(false);
  toast('Private access reserved');
});

document.addEventListener('pointermove', (event) => {
  const hero = event.target.closest('[data-parallax]');
  if (!hero || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bounds = hero.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width - 0.5;
  const y = (event.clientY - bounds.top) / bounds.height - 0.5;
  hero.style.setProperty('--parallax-x', `${x * 10}px`);
  hero.style.setProperty('--parallax-y', `${y * 8}px`);
});

document.addEventListener('pointerleave', () => {
  const hero = document.querySelector('[data-parallax]');
  if (hero) {
    hero.style.setProperty('--parallax-x', '0px');
    hero.style.setProperty('--parallax-y', '0px');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !state.bagOpen) return;
  state.bagOpen = false;
  render(false);
});

window.addEventListener('hashchange', () => {
  const route = routeFromHash();
  state.screen = route.screen;
  state.selectedProduct = route.product;
  state.bagOpen = false;
  render(true);
  scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

if (!location.hash) history.replaceState(null, '', '#home');
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
render(true);

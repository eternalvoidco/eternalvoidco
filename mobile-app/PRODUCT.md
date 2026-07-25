# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Both new and returning visitors, roughly equally weighted:
- Returning VOID customers who already know the brand from the main site, using the PWA as a faster, mobile-native way to browse Season One, save pieces, and join the private access list.
- New streetwear/fashion buyers discovering Eternal Void for the first time on mobile, for whom the app shell itself is a first impression and must sell the brand's positioning, not just serve a catalog.

## Product Purpose

A mobile-first Progressive Web App preview (Phase 1) for Eternal Void, an oversized-fit streetwear label. It lets visitors browse Season One (five limited pieces), view product detail, save pieces to a private archive, add to a bag, and request private access to future releases — as an installable, app-like mobile experience rather than a responsive website.

## Positioning

Atelier-grade construction quality is the primary, truthfully-ownable claim: heavyweight fabrications (380–460 GSM cotton), individually finished garments with natural piece-to-piece variation, and composition/care detail treated as real product information — not marketing flourish. Scarcity (numbered editions, e.g. "Edition 01/40") and private-access/invitation framing reinforce this but construction quality is the mechanism a neighboring brand could not truthfully copy without matching the fabrication.

## Operating Context

- Phase 1 of a multi-phase rollout; this app is intentionally isolated from and does not modify the existing eternalvoidco.com website, its Shopify checkout, Vercel functions, or Supabase integration.
- Season One is the only live collection: 5 products, fixed names/prices/fit copy/edition counts, reused verbatim from the main site.
- Core flows: home → shop (collection grid) → product detail → size selection → add to bag → bag review; save/unsave to a private archive (wishlist); join-list request for private access; a placeholder member profile screen.
- Real checkout, live pre-order submission, and Supabase-backed accounts are explicitly deferred to a later backend integration phase and must not be simulated as functional in this shell.

## Capabilities and Constraints

- **Phase 1 is local-only, no backend**: cart, wishlist, and join/access state persist only in the browser via `localStorage`. There is no server, no real order pipeline, and no account system yet — future work must not fake real checkout or order history.
- **Must never diverge from main-site product truth**: product names, prices, fit copy, materials, and the EV emblem asset are reused from the eternalvoidco website repository and must stay in sync with it, not be invented independently within this app.
- **PWA/offline installability is a real, load-bearing requirement**, not decorative: `manifest.webmanifest`, a service worker, and installability must keep working as this surface evolves — treat this as a genuine installable app, not just a responsive page.
- Plain Vite + vanilla JS/CSS stack (no framework), hash-based routing, no build-time product data source beyond the hardcoded array in `src/main.js`.
- "Orders" and "Account settings" are explicitly marked Phase Two and disabled in the current UI; that phase gating is a real product fact, not a placeholder to silently remove.

## Brand Commitments

- Name: **Eternal Void** ("ETERNAL VOID" wordmark, "EV" monogram/emblem).
- Voice: restrained, ritualistic, editorial — "objects" not "products," "atelier" not "shop," emphasis on presence, controlled volume, and quiet exclusivity over hype or urgency.
- The EV emblem image and Season One campaign video/poster are established brand assets reused as-is from the main site.

## Evidence on Hand

- Full Season One product data (names, prices, fit, description, color, material, edition count) is present in `src/main.js` and is real, not placeholder.
- No customer testimonials, press, case studies, or sales data exist yet; future work must not fabricate them.

## Product Principles

1. Preserve product truth: this app is a presentation layer over facts owned by the main site, never an independent source of product claims.
2. Respect the phase boundary: functionality gated to "Phase Two" (accounts, real checkout, orders) stays visibly deferred, not silently implemented or faked.
3. Treat installability as a real requirement: every change should keep the app usable as an installed, app-like PWA, not just a mobile-responsive page.
4. Construction-quality and scarcity claims must stay truthful and specific (real GSM weights, real edition counts) rather than generic luxury language.
5. Serve both first-time and returning visitors: the shell must both introduce the brand credibly and stay fast/frictionless for repeat use.

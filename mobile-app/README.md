# VOID Mobile PWA - Phase 1

This isolated Vite application is a mobile-first Phase 1 preview. It does not change the existing VOID website, Shopify checkout, Vercel functions, or Supabase integration.

## Local preview

From this directory, run:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`.

To verify the production build:

```powershell
npm run build
npm run preview
```

Open the URL printed by Vite, normally `http://localhost:4173`.

## Phase 1 scope

- Mobile app shell, PWA metadata, and offline shell cache
- Home, collection, product detail, join-list, saved pieces, bag, and profile placeholder screens
- Existing Season One names, prices, fit copy, and EV emblem reused from the website repository
- Bag, saved pieces, and join-list preview state stored locally in the browser only

Shopify checkout, live pre-order submission, and Supabase account data intentionally remain in the existing website until a later backend integration phase.

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC runtime config for the static frontend.
//
// A static site can't read process.env in the browser, so this endpoint hands
// the frontend ONLY the values that are safe to be public: the Supabase Project
// URL and the anon / publishable key. Both are read from environment variables
// (set in Vercel → Settings → Environment Variables) — nothing is hardcoded.
//
// The Supabase service_role (secret) key is NEVER read or returned here.
// ─────────────────────────────────────────────────────────────────────────────
export default function handler(request, response) {
    // Never cache — env can change between deploys.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');

    return response.status(200).json({
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
        // Publishable by design — it is the key Stripe.js is meant to run with.
        // STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are never read here.
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
    });
}

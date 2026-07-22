// ─────────────────────────────────────────────────────────────────────────────
// Reusable Supabase client for the VOID static site.
//
// - Loads the official supabase-js v2 from its ESM CDN build (no bundler needed).
// - Reads the PUBLIC config (url + anon key) from /api/config, which serves them
//   from environment variables. Nothing is hardcoded; the service_role key is
//   never involved.
// - Exposes a single shared client plus thin auth helpers.
//
// Usage:
//   import { getSupabase, signIn, signUp, signOut, getSession, onAuthChange }
//     from '/assets/supabase-client.js';
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let clientPromise = null;

// Returns the shared Supabase client, or throws if the project isn't configured.
export function getSupabase() {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
        let cfg;
        try {
            const res = await fetch('/api/config', { cache: 'no-store' });
            if (!res.ok) throw new Error('config_unavailable');
            cfg = await res.json();
        } catch (e) {
            throw new Error('Could not load configuration. Please try again.');
        }
        if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
            throw new Error('Sign-in is not configured yet.');
        }
        return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
    })();
    return clientPromise;
}

// True if the backend is configured (does not throw).
export async function isConfigured() {
    try { await getSupabase(); return true; } catch (e) { return false; }
}

export async function signUp(email, password, redirectTo) {
    const sb = await getSupabase();
    return sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo || (location.origin + '/?confirmed=1') }
    });
}

export async function signIn(email, password) {
    const sb = await getSupabase();
    return sb.auth.signInWithPassword({ email, password });
}

export async function signInWithProvider(provider, redirectTo) {
    const sb = await getSupabase();
    return sb.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo || (location.origin + '/') } });
}

export async function resetPassword(email, redirectTo) {
    const sb = await getSupabase();
    return sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo || (location.origin + '/') });
}

export async function signOut() {
    const sb = await getSupabase();
    return sb.auth.signOut();
}

export async function getSession() {
    const sb = await getSupabase();
    const { data } = await sb.auth.getSession();
    return data ? data.session : null;
}

export async function onAuthChange(callback) {
    const sb = await getSupabase();
    return sb.auth.onAuthStateChange((event, session) => callback(event, session));
}

// Convenience: a display name for a Supabase user (falls back to email).
export function displayName(user) {
    if (!user) return '';
    const m = user.user_metadata || {};
    return m.full_name || m.name || m.user_name || m.preferred_username || user.email || '';
}

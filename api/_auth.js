// ─────────────────────────────────────────────────────────────────────────────
// Identity, resolved server-side.
//
// The browser proves who it is with the Supabase access token it already holds;
// the server asks Supabase who that token belongs to. Nothing in a request body
// is ever taken as an identity or a role.
// ─────────────────────────────────────────────────────────────────────────────

// Returns the Supabase user for the request's bearer token, or null.
export async function resolveUser(request) {
    const header = (request.headers && request.headers.authorization) || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const anon = process.env.SUPABASE_ANON_KEY || '';
    if (!token || !base || !anon) return null;

    try {
        const res = await fetch(`${base}/auth/v1/user`, {
            headers: { apikey: anon, Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const user = await res.json();
        return user && user.id ? user : null;
    } catch (error) {
        return null;
    }
}

// VOID_ADMIN_EMAILS: comma-separated list of the accounts allowed into the
// inventory dashboard. Unset means nobody is — the dashboard fails closed.
function adminEmails() {
    return (process.env.VOID_ADMIN_EMAILS || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
}

export function adminConfigured() {
    return adminEmails().length > 0;
}

// { ok: true, user } or { ok: false, status, error }. A user must hold a valid
// session, have confirmed the address, and be on the allowlist.
export async function requireAdmin(request) {
    if (!adminConfigured()) return { ok: false, status: 503, error: 'admin_not_configured' };

    const user = await resolveUser(request);
    if (!user) return { ok: false, status: 401, error: 'unauthenticated' };

    const email = String(user.email || '').toLowerCase();
    const confirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
    if (!email || !confirmed || !adminEmails().includes(email)) {
        return { ok: false, status: 403, error: 'forbidden' };
    }
    return { ok: true, user: { id: user.id, email } };
}

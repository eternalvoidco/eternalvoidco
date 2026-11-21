// ─────────────────────────────────────────────────────────────────────────────
// EV for Artists — intake, storage and notification helpers.
//
// Everything here runs server-side with the service-role key, exactly as
// _orders.js does, and for a stronger reason: this table holds unpublished work
// by people who have no contract with us. There is no browser path to it at
// all — the anon key cannot read a row, and a signed-in customer's key cannot
// either. RLS denies, and only this side bypasses it.
//
// Files never pass through a function. The browser is handed a short-lived
// signed URL and uploads straight to a private bucket; the function records the
// path and nothing else. No artwork is ever in a request body we log, in an
// analytics payload, or attached to an email.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { rpc, describeSupabaseError } from './_orders.js';

const BASE = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const BUCKET = 'artist-submissions';
export const MAX_BYTES = 15 * 1024 * 1024;
export const TYPES = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png'
};

// The version of the Submission Terms this deployment serves. Recorded against
// every submission, from here rather than from the browser: what matters is
// what we published, not what a client claimed to have seen.
// 2026-11-21 added the tech-pack condition and the net-profit basis to clause
// 7. The 2026-11-19 text stays readable, unchanged, at
// /legal/ev-for-artists-submission-terms/2026-11-19 for anyone who accepted it.
export const TERMS_VERSION = process.env.VOID_ARTIST_TERMS_VERSION || '2026-11-21';

// Until the owner has approved the rate and the terms, and counsel has
// reviewed the drafts, the public endpoint refuses to record anything. The
// whole path is live and testable behind this one switch.
export function intakeOpen() {
    return String(process.env.VOID_ARTIST_INTAKE || '').toLowerCase() === 'open';
}

export function artistsConfigured() {
    return Boolean(BASE() && SERVICE_KEY());
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── References ───────────────────────────────────────────────────────────────
// EVA-<yy>-<6 base32 chars>. Human-readable, quotable in an email, and not a
// credential: knowing one grants nothing anywhere.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateReference(now = new Date()) {
    const bytes = crypto.randomBytes(6);
    let tail = '';
    for (let i = 0; i < 6; i += 1) tail += ALPHABET[bytes[i] % ALPHABET.length];
    return `EVA-${String(now.getUTCFullYear()).slice(-2)}-${tail}`;
}

// A caller, counted without being identified: salted hash, and the salt is an
// environment secret the database never sees. Enough to rate limit, useless as
// a record of who visited.
export function callerHash(request) {
    const salt = process.env.VOID_ARTIST_IP_SALT || '';
    if (!salt) return null;
    const forwarded = String((request.headers && request.headers['x-forwarded-for']) || '');
    const ip = forwarded.split(',')[0].trim();
    if (!ip) return null;
    return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 40);
}

// ── Storage ──────────────────────────────────────────────────────────────────
function storageHeaders(extra) {
    const key = SERVICE_KEY();
    const headers = Object.assign({ apikey: key }, extra || {});
    // Same two key formats _orders.js documents: a legacy JWT authenticates
    // through Authorization, an sb_secret_ key through apikey alone.
    if (key.split('.').length === 3 && key.startsWith('ey')) headers.Authorization = `Bearer ${key}`;
    else headers.Authorization = `Bearer ${key}`;
    return headers;
}

async function storage(path, init) {
    const res = await fetch(`${BASE()}/storage/v1${path}`, init);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text.slice(0, 200) }; }
    if (!res.ok) {
        throw Object.assign(new Error((data && (data.message || data.error)) || 'storage_failed'), {
            code: 'storage_error', status: res.status, op: path.split('?')[0]
        });
    }
    return data;
}

// Where a submission's file lives. The path is chosen here and never by the
// client: a caller cannot name a path, overwrite another submission's object,
// or escape the bucket.
export function storagePath(reference, mimeType, now = new Date()) {
    const ext = TYPES[mimeType] || 'bin';
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}/${mm}/${reference}.${ext}`;
}

// A one-shot URL the browser can PUT the file to, valid for minutes. The bytes
// go straight from the artist to private storage.
export async function signUpload(path) {
    const data = await storage(`/object/upload/sign/${BUCKET}/${encodeURI(path)}`, {
        method: 'POST',
        headers: storageHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({})
    });
    const signed = data && (data.url || data.signedURL || data.signedUrl);
    if (!signed) throw Object.assign(new Error('no_signed_upload_url'), { code: 'storage_error' });
    return `${BASE()}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
}

// Is the object really there, and how big is it? Asked of storage rather than
// taken from the client, so a submission is only confirmed against a file that
// actually landed.
export async function statObject(path) {
    const slash = path.lastIndexOf('/');
    const prefix = slash === -1 ? '' : path.slice(0, slash);
    const name = slash === -1 ? path : path.slice(slash + 1);
    const rows = await storage(`/object/list/${BUCKET}`, {
        method: 'POST',
        headers: storageHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefix, search: name, limit: 1 })
    });
    const hit = Array.isArray(rows) ? rows.find((row) => row && row.name === name) : null;
    if (!hit) return null;
    const meta = hit.metadata || {};
    return { size: Number(meta.size) || 0, mimeType: meta.mimetype || null };
}

// A short-lived link for a reviewer who has already been checked. Minutes, not
// hours — long enough to open a PDF, short enough that a copied URL in a chat
// log is worthless by the time anyone finds it.
export async function signDownload(path, seconds = 300) {
    const data = await storage(`/object/sign/${BUCKET}/${encodeURI(path)}`, {
        method: 'POST',
        headers: storageHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: Math.max(30, Math.min(seconds, 900)) })
    });
    const signed = data && (data.signedURL || data.signedUrl || data.url);
    if (!signed) throw Object.assign(new Error('no_signed_url'), { code: 'storage_error' });
    return `${BASE()}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
}

export async function removeObject(path) {
    return storage(`/object/${BUCKET}`, {
        method: 'DELETE',
        headers: storageHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [path] })
    });
}

// ── Email ────────────────────────────────────────────────────────────────────
// Resend over fetch, as the rest of the project does. Never carries artwork,
// a file link, or a portfolio URL — a receipt is a receipt.
const FROM = 'EV for Artists <artists@eternalvoid.co>';

export function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function sendEmail({ to, subject, html, replyTo }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.warn('artists: RESEND_API_KEY not set —', subject, 'not sent');
        return false;
    }
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign(
                { from: FROM, to: [to], subject, html },
                replyTo ? { reply_to: replyTo } : {}
            ))
        });
        if (!res.ok) {
            console.error('artists: email rejected', res.status, subject);
            return false;
        }
        return true;
    } catch (error) {
        console.error('artists: email failed —', error && error.message);
        return false;
    }
}

const SHELL = (body) => `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;background-color:#030302;">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#030302;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#030302;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
        <tr><td style="padding-bottom:30px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:0.34em;color:#f3f0ea;">VOID<sup style="font-size:10px;">&copy;</sup></div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#c7a96c;margin-top:10px;">EV for Artists</div>
        </td></tr>
        ${body}
      </table>
    </td></tr>
  </table>
</body></html>`;

const P = (text) => `<tr><td style="padding-bottom:16px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.8;color:#b9b2a6;">${text}</td></tr>`;

// What the artist gets. The reference, what happens next, and how to withdraw.
// No link to the file and no copy of the work.
// The receipt quotes the version of the Submission Terms the artist accepted,
// as clause 11 of those terms says it does.
export function receiptHtml({ name, reference, title, termsVersion }) {
    return SHELL(`
        <tr><td style="padding-bottom:10px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#c7a96c;">Received</td></tr>
        <tr><td style="padding-bottom:22px;font-family:Georgia,serif;font-size:25px;line-height:1.25;color:#f3f0ea;">Your design is with the atelier.</td></tr>
        ${P(`${escapeHtml(name)}, we have <b style="color:#f3f0ea;font-weight:500;">${escapeHtml(title)}</b>. It is in private storage and will be read by our internal review team.`)}
        <tr><td style="padding:16px 0 20px;">
          <div style="display:inline-block;border:1px solid rgba(199,169,108,0.55);padding:12px 20px;">
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:9px;letter-spacing:0.26em;text-transform:uppercase;color:#7d776c;margin-bottom:6px;">Submission reference</div>
            <div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;letter-spacing:0.2em;color:#e8d09e;">${escapeHtml(reference)}</div>
          </div>
        </td></tr>
        ${P('Keep this reference. If the design is shortlisted we will write to you directly. We do not publish a guaranteed response time, and no news is not a decision.')}
        ${P('You keep ownership of your work. Submitting does not give us permission to publish it, manufacture it, use it commercially, or train AI on it. Production would require a separate agreement signed by both of us.')}
        ${P('To withdraw, reply to this message quoting the reference. We will stop reviewing it and delete the uploaded files.')}
        <tr><td style="padding-top:18px;border-top:1px solid rgba(255,255,255,0.08);font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#6f675b;">
          ${termsVersion ? `You accepted the Submission Terms, version ${escapeHtml(termsVersion)}.<br>` : ''}
          <a href="https://eternalvoid.co/legal/ev-for-artists-submission-terms" style="color:#8f8778;">Submission Terms</a> &middot;
          <a href="https://eternalvoid.co/legal/ev-for-artists-privacy-notice" style="color:#8f8778;">Privacy Notice</a> &middot;
          <a href="mailto:artists@eternalvoid.co" style="color:#8f8778;">artists@eternalvoid.co</a>
        </td></tr>`);
}

// What the atelier gets. Enough to triage, and a link to the queue rather than
// to the work — the file stays behind the admin check.
export function atelierHtml({ reference, name, email, country, title, description, hasFile, portfolio }) {
    return SHELL(`
        <tr><td style="padding-bottom:10px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#c7a96c;">New submission</td></tr>
        <tr><td style="padding-bottom:20px;font-family:Georgia,serif;font-size:22px;line-height:1.3;color:#f3f0ea;">${escapeHtml(title)}</td></tr>
        ${P(`<b style="color:#f3f0ea;font-weight:500;">${escapeHtml(reference)}</b><br>${escapeHtml(name)} &middot; ${escapeHtml(email)} &middot; ${escapeHtml(country)}`)}
        ${P(escapeHtml(description).replace(/\n/g, '<br>'))}
        ${P(`Attachment: ${hasFile ? 'yes — open it from the queue' : 'none'}${portfolio ? `<br>Portfolio: ${escapeHtml(portfolio)}` : ''}`)}
        <tr><td style="padding-top:18px;">
          <a href="https://eternalvoid.co/admin/artists" style="display:inline-block;border:1px solid rgba(199,169,108,0.6);padding:11px 20px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#e8d09e;text-decoration:none;">Open the queue</a>
        </td></tr>`);
}

export { rpc, describeSupabaseError };

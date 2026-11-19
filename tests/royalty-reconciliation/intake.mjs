// The closed intake, exercised through the real handler.
//
// api/_artist-submission.js is imported as written. Its two outside
// dependencies are stubbed at the module boundary: Supabase RPC is pointed at
// the real migrations running in PGlite, and Storage is a small in-memory
// bucket that behaves the way the real one is configured to (private, one
// object per path, overwrite refused).
import { boot } from './boot.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api') + path.sep;
const WORK = path.join(process.cwd(), '.stub');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'package.json'), JSON.stringify({ type: 'module' }));

const db = await boot();

// ── the stubbed bucket ──────────────────────────────────────────────────────
const bucket = new Map();          // path -> { size, mimeType }
const signed = new Map();          // token -> path
let uploadSeq = 0;
const audit = [];

globalThis.__bucket = bucket;
globalThis.__signed = signed;
globalThis.__audit = audit;

globalThis.__db = db;
globalThis.__rpc = async (name, args) => {
    const keys = Object.keys(args || {});
    const sql = `select public.${name}(${keys.map((k, i) => `$${i + 1}`).join(',')}) as r`;
    const { rows } = await db.query(sql, keys.map((k) => {
        const v = args[k];
        return v && typeof v === 'object' ? JSON.stringify(v) : v;
    }));
    return rows[0].r;
};

// Rewrite the two helper modules so the handler keeps its own logic but talks
// to the stubs. Nothing in _artist-submission.js itself is touched.
const artistsSrc = fs.readFileSync(API + '_artists.js', 'utf8');
const stubbed = artistsSrc
    .replace(/^import crypto from 'node:crypto';$/m, "import crypto from 'node:crypto';")
    .replace(/^import \{ rpc, describeSupabaseError \} from '\.\/_orders\.js';$/m,
        `const rpc = (...a) => globalThis.__rpc(...a);
         const describeSupabaseError = (e, c) => c + ': ' + (e && e.message);`)
    // storage, in memory
    .replace(/export async function signUpload\(path\) \{[\s\S]*?\n\}/,
        `export async function signUpload(p) {
            const token = 'tok_' + (++globalThis.__uploadSeq);
            globalThis.__signed.set(token, p);
            return 'https://stub/upload?token=' + token;
        }`)
    .replace(/export async function statObject\(path\) \{[\s\S]*?\n\}/,
        `export async function statObject(p) {
            return globalThis.__bucket.get(p) || null;
        }`)
    .replace(/export async function signDownload\(path, seconds = 300\) \{[\s\S]*?\n\}/,
        `export async function signDownload(p, seconds = 300) {
            return 'https://stub/dl?p=' + encodeURIComponent(p) + '&exp=' + seconds;
        }`)
    .replace(/export async function removeObject\(path\) \{[\s\S]*?\n\}/,
        `export async function removeObject(p) {
            globalThis.__audit.push(['remove', p]);
            globalThis.__bucket.delete(p);
            return { ok: true };
        }`)
    .replace(/export async function sendEmail\(\{[\s\S]*?\n\}/,
        `export async function sendEmail(m) { globalThis.__audit.push(['email', m.to, m.subject]); return true; }`)
    .replace(/export function artistsConfigured\(\) \{[\s\S]*?\n\}/,
        'export function artistsConfigured() { return true; }');
globalThis.__uploadSeq = uploadSeq;
fs.writeFileSync(path.join(WORK, '_artists.js'), stubbed);

// requireAdmin, driven by a global so each case can choose who is calling.
fs.writeFileSync(path.join(WORK, '_auth.js'), `
export async function requireAdmin() {
    return globalThis.__admin
        ? { ok: true, user: { id: 'u1', email: globalThis.__admin } }
        : { ok: false, status: 401, error: 'unauthenticated' };
}
`);

let handlerSrc = fs.readFileSync(API + '_artist-submission.js', 'utf8');
fs.writeFileSync(path.join(WORK, '_artist-submission.js'), handlerSrc);

const { default: handler } = await import(pathToFileURL(path.join(WORK, '_artist-submission.js')).href);

// ── a tiny request/response pair ────────────────────────────────────────────
function call(body, { admin = null } = {}) {
    globalThis.__admin = admin;
    const res = {
        statusCode: null, payload: null, headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(c) { this.statusCode = c; return this; },
        json(p) { this.payload = p; return this; },
        send(p) { this.payload = p; return this; }
    };
    return handler({ method: 'POST', headers: {}, body }, res).then(() => res);
}

// The browser's PUT to the signed URL, with the bucket's own rules applied.
function upload(url, { bytes, mimeType, upsert = false }) {
    const token = new URL(url).searchParams.get('token');
    const target = signed.get(token);
    if (!target) return { ok: false, status: 400, why: 'unknown token' };
    if (bucket.has(target) && !upsert) return { ok: false, status: 409, why: 'object exists and x-upsert is false' };
    bucket.set(target, { size: bytes, mimeType });
    return { ok: true, path: target };
}

// A fresh address per case: the endpoint rate-limits three submissions per
// address per hour, which is the behaviour under test elsewhere and would
// otherwise quietly truncate these.
let who = 0;
const FIELDS = () => ({
    name: 'Test Artist', email: 'test' + (++who) + '@studio.co', country: 'Hungary',
    title: 'A heavyweight tee', description: 'Black loopback, dropped shoulder.',
    acceptTerms: true, locale: 'en'
});
const WITH_FILE = () => ({ ...FIELDS(), file: { name: 'a.pdf', type: 'application/pdf', size: 1024 } });

let fails = 0;
const ok = (n, a, e, extra) => {
    const p = JSON.stringify(a) === JSON.stringify(e);
    console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}`);
    console.log(`          expected ${JSON.stringify(e)}   actual ${JSON.stringify(a)}${extra ? '   ' + extra : ''}`);
    if (!p) fails += 1;
};
const count = async () => (await db.query('select count(*)::int as n from public.artist_submissions')).rows[0].n;

console.log('\n── A · the gate is closed (VOID_ARTIST_INTAKE unset) ──');
delete process.env.VOID_ARTIST_INTAKE;
{
    let r = await call(WITH_FILE());
    ok('an unauthenticated visitor cannot create a draft',
       [r.statusCode, r.payload.closed, r.payload.ok], [503, true, false]);
    ok('and nothing was recorded', await count(), 0);
    ok('and no upload URL was minted', signed.size, 0);

    r = await call({ confirm: 'EVA-26-AAAAAA', token: 'guess', path: '2026/11/EVA-26-AAAAAA.pdf' });
    ok('nor can one be finalised directly', [r.statusCode, r.payload.closed], [503, true]);

    // The query string lives in the browser. It is not in the request at all,
    // so there is nothing here it could change — but prove it.
    r = await call({ ...WITH_FILE(), intake: 'preview', preview: true, isPreview: true });
    ok('a body claiming preview changes nothing', [r.statusCode, r.payload.closed], [503, true]);
    ok('still nothing recorded', await count(), 0);
}

console.log('\n── B · an administrator rehearsing through the closed gate ──');
{
    const r = await call(WITH_FILE(), { admin: 'owner@eternalvoid.co' });
    ok('is let through', [r.statusCode, r.payload.ok, r.payload.pending], [200, true, true]);
    const row = (await db.query('select reference, status, is_preview, file_path from public.artist_submissions')).rows[0];
    ok('and the submission is flagged as a rehearsal', row.is_preview, true);
    ok('with a server-chosen path scoped to its own reference',
       row.file_path, `2026/11/${row.reference}.pdf`,
       '(the client never names the path)');

    // Finish it, the way the browser does.
    const up = upload(r.payload.uploadUrl, { bytes: 1024, mimeType: 'application/pdf' });
    ok('the upload lands at that path', up.path, row.file_path);
    const again = upload(r.payload.uploadUrl, { bytes: 99, mimeType: 'application/pdf' });
    ok('a second upload to the same signed URL is refused (overwrite disabled)',
       [again.ok, again.status], [false, 409]);

    const done = await call({ confirm: r.payload.reference, token: r.payload.token },
        { admin: 'owner@eternalvoid.co' });
    ok('confirming moves it into the queue', [done.statusCode, done.payload.ok], [200, true]);
    const after = (await db.query('select status, file_state from public.artist_submissions')).rows[0];
    ok('status and file state', [after.status, after.file_state], ['received', 'stored']);

    // Now that it has left draft, the queue would normally show it.
    const queue = await globalThis.__rpc('artist_submissions_list', { p_status: null, p_limit: 100, p_offset: 0 });
    ok('a confirmed rehearsal is still kept out of the reviewer queue', queue.rows.length, 0);
    const withPreview = await globalThis.__rpc('artist_submissions_list',
        { p_status: null, p_limit: 100, p_offset: 0, p_include_preview: true });
    ok('and is visible only when asked for',
       [withPreview.rows.length, withPreview.previewCount], [1, 1]);
}

console.log('\n── C · a confirm call cannot reach another submission\'s file ──');
{
    // Two rehearsals, each with its own draft and its own token.
    const a = await call(WITH_FILE(), { admin: 'owner@eternalvoid.co' });
    const b = await call(WITH_FILE(), { admin: 'owner@eternalvoid.co' });
    upload(a.payload.uploadUrl, { bytes: 1024, mimeType: 'application/pdf' });
    upload(b.payload.uploadUrl, { bytes: 2048, mimeType: 'application/pdf' });

    // A's token, pointed at B's object. The old code took `path` from the body
    // and would have stat'ed B's file.
    const crossed = await call(
        { confirm: a.payload.reference, token: a.payload.token, path: b.payload.path },
        { admin: 'owner@eternalvoid.co' });
    const confirmedA = (await db.query(
        'select file_path, file_size from public.artist_submissions where reference = $1',
        [a.payload.reference])).rows[0];
    ok('the body\'s path is ignored entirely',
       confirmedA.file_path, a.payload.path, '(A still points at A)');
    ok('and A is sized from A\'s own object', confirmedA.file_size, 1024,
       '(B\'s object is 2048)');
    ok('the call still succeeds, because nothing about it was wrong except the path it offered',
       crossed.statusCode, 200);

    const wrongToken = await call(
        { confirm: b.payload.reference, token: 'not-the-token' }, { admin: 'owner@eternalvoid.co' });
    ok('a wrong token confirms nothing', wrongToken.statusCode, 404);
}

console.log('\n── D · what actually landed is checked, not what was promised ──');
{
    const r = await call(WITH_FILE(), { admin: 'owner@eternalvoid.co' });
    // Declared a 1 KB PDF; uploaded 20 MB.
    upload(r.payload.uploadUrl, { bytes: 20 * 1024 * 1024, mimeType: 'application/pdf' });
    const big = await call({ confirm: r.payload.reference, token: r.payload.token },
        { admin: 'owner@eternalvoid.co' });
    ok('an oversized object is refused at confirmation', big.statusCode, 413);
    ok('and removed from storage', bucket.has(r.payload.path), false);

    const r2 = await call(WITH_FILE(), { admin: 'owner@eternalvoid.co' });
    upload(r2.payload.uploadUrl, { bytes: 2048, mimeType: 'application/x-msdownload' });
    const bad = await call({ confirm: r2.payload.reference, token: r2.payload.token },
        { admin: 'owner@eternalvoid.co' });
    ok('a disallowed type is refused', bad.statusCode, 415);
    ok('and removed too', bucket.has(r2.payload.path), false);
}

console.log('\n── E · retries, abandoned uploads, and the sweep ──');
{
    const before = await count();
    const r = await call(WITH_FILE(), { admin: 'owner@eternalvoid.co' });

    // Confirming before the bytes arrive.
    const early = await call({ confirm: r.payload.reference, token: r.payload.token },
        { admin: 'owner@eternalvoid.co' });
    ok('confirming an upload that never landed is refused', early.statusCode, 409);

    upload(r.payload.uploadUrl, { bytes: 1024, mimeType: 'application/pdf' });
    const first = await call({ confirm: r.payload.reference, token: r.payload.token },
        { admin: 'owner@eternalvoid.co' });
    const retry = await call({ confirm: r.payload.reference, token: r.payload.token },
        { admin: 'owner@eternalvoid.co' });
    ok('confirming twice is safe and says so',
       [first.statusCode, retry.statusCode, retry.payload.alreadyConfirmed], [200, 200, true]);

    // An upload abandoned between step 1 and step 2.
    const dead = await call(WITH_FILE(), { admin: 'owner@eternalvoid.co' });
    upload(dead.payload.uploadUrl, { bytes: 4096, mimeType: 'application/pdf' });
    ok('an unconfirmed draft is invisible to reviewers',
       (await globalThis.__rpc('artist_submissions_list',
           { p_status: null, p_limit: 100, p_offset: 0, p_include_preview: true })).rows
           .some((x) => x.reference === dead.payload.reference), false);

    const received = (await db.query(`select count(*)::int as n from public.artist_submissions where status='received'`)).rows[0].n;
    await db.query(`update public.artist_submissions set created_at = now() - interval '48 hours'
                     where status = 'draft'`);
    const swept = await globalThis.__rpc('artist_submissions_sweep_drafts', { p_older_than: '24 hours' });
    ok('the sweep returns the paths so row and file go together',
       swept.paths.includes(dead.payload.path), true);
    for (const p of swept.paths) bucket.delete(p);
    ok('and the abandoned object is gone', bucket.has(dead.payload.path), false);
    ok('while every confirmed submission survives untouched',
       (await db.query(`select count(*)::int as n from public.artist_submissions where status='received'`)).rows[0].n,
       received);
    ok('and no draft is left behind',
       (await db.query(`select count(*)::int as n from public.artist_submissions where status='draft'`)).rows[0].n, 0);
}

console.log('\n── F · the gate open ──');
process.env.VOID_ARTIST_INTAKE = 'open';
{
    const r = await call(FIELDS());          // no admin, no file
    ok('an ordinary visitor is accepted', [r.statusCode, r.payload.ok], [200, true]);
    const row = (await db.query(
        'select is_preview, status from public.artist_submissions where reference = $1',
        [r.payload.reference])).rows[0];
    ok('and is not flagged as a rehearsal', row.is_preview, false);
    ok('a submission with no file joins the queue immediately', row.status, 'received');

    const noTerms = await call({ ...FIELDS(), acceptTerms: false });
    ok('the terms checkbox still gates it', noTerms.statusCode, 400);
}

console.log(`\n${fails ? fails + ' FAILED' : 'all passed'}`);
process.exit(fails ? 1 : 0);

// Test stack, assembled from real parts wherever possible:
//
//   Postgres      a fresh database per test file, with a minimal Supabase role
//                 setup (supabase-bootstrap.sql) and then every file in
//                 supabase/migrations applied in order — the same SQL production
//                 runs.
//   PostgREST     the real binary, which is what Supabase serves /rest/v1 with.
//   Dev server    serves the static site and runs the real api/ handlers with
//                 Vercel's request/response conventions and vercel.json
//                 rewrites. It also answers /rest/v1 (proxied to PostgREST) and
//                 /auth/v1/user (a token table) on the same origin, standing in
//                 for the Supabase gateway.
//   Stripe        stripe-double.mjs, in-process. No network, no real charge.
//
// Requires a running Postgres reachable as superuser (PGHOST, PGPORT, PGUSER;
// defaults /tmp, 54329, postgres) and a PostgREST binary (POSTGREST_BIN, or
// ./.postgrest/postgrest — see README.md).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { createStripeDouble } from './stripe-double.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

const PG = {
    host: process.env.PGHOST || '/tmp',
    port: Number(process.env.PGPORT || 54329),
    user: process.env.PGUSER || 'postgres'
};

const JWT_SECRET = 'void-inventory-tests-jwt-secret-0123456789abcdef';
const WEBHOOK_SECRET = 'whsec_void_inventory_tests';

function signJwt(claims) {
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
}

async function freePort() {
    return new Promise((resolve) => {
        const srv = http.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

// ── database ────────────────────────────────────────────────────────────────
// `strict` mimics newer Supabase projects, which no longer grant new tables,
// functions and sequences in `public` to the API roles by default: the
// migrations must grant everything they need themselves.
async function createDatabase(name, { strict = false } = {}) {
    const admin = new pg.Client({ ...PG, database: 'postgres' });
    await admin.connect();
    // Roles are cluster-wide: created once, reused by every test database.
    const roles = await admin.query("select 1 from pg_roles where rolname = 'service_role'");
    await admin.query(`create database ${name}`);
    await admin.end();

    const db = new pg.Client({ ...PG, database: name });
    await db.connect();
    let bootstrap = fs.readFileSync(path.join(HERE, 'supabase-bootstrap.sql'), 'utf8');
    if (roles.rowCount) bootstrap = bootstrap.replace(/^create role .*$/gm, '').replace(/^grant anon, authenticated, service_role to authenticator;$/m, '');
    if (strict) bootstrap = bootstrap.replace(/^alter default privileges .*$/gm, '');
    await db.query(bootstrap);
    for (const file of fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).sort()) {
        await db.query(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8'));
    }
    return db;
}

export async function applyInventoryMigrationAgain(db) {
    const file = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).find((f) => f.includes('inventory'));
    await db.query(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8'));
}

async function dropDatabase(name) {
    const admin = new pg.Client({ ...PG, database: 'postgres' });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
}

// ── PostgREST ───────────────────────────────────────────────────────────────
async function startPostgrest(dbName) {
    const bin = process.env.POSTGREST_BIN || path.join(HERE, '.postgrest', 'postgrest');
    if (!fs.existsSync(bin)) throw new Error(`PostgREST binary not found at ${bin} — see tests/inventory/README.md`);
    const port = await freePort();
    const conf = path.join(HERE, '.postgrest', `${dbName}.conf`);
    fs.mkdirSync(path.dirname(conf), { recursive: true });
    fs.writeFileSync(conf, [
        `db-uri = "host=${PG.host} port=${PG.port} dbname=${dbName} user=authenticator password=authenticator"`,
        'db-schemas = "public"',
        'db-anon-role = "anon"',
        `jwt-secret = "${JWT_SECRET}"`,
        'server-host = "127.0.0.1"',
        `server-port = ${port}`,
        'db-pool = 20',
        'log-level = "crit"'
    ].join('\n'));
    const proc = spawn(bin, [conf], { stdio: ['ignore', 'ignore', 'inherit'] });
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i += 1) {
        try {
            const res = await fetch(`${url}/`);
            if (res.ok) return { proc, url, conf };
        } catch (e) { /* not yet */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    proc.kill();
    throw new Error('PostgREST did not start');
}

// ── dev server ──────────────────────────────────────────────────────────────
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json'
};

function vercelConfig() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
}

function augment(res) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(obj));
        return res;
    };
    res.send = (body) => { res.end(body); return res; };
    return res;
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

export async function startStack({ env = {}, strict = process.env.STRICT_GRANTS === '1' } = {}) {
    const dbName = `ev_${crypto.randomBytes(5).toString('hex')}`;
    const db = await createDatabase(dbName, { strict });
    const rest = await startPostgrest(dbName);
    const stripe = createStripeDouble({ webhookSecret: WEBHOOK_SECRET });
    stripe.install();

    // Resend, captured: every email the handlers send lands in `emails`
    // instead of leaving the machine. `emailFailures` > 0 makes the next
    // sends fail, as a provider outage would.
    const emails = [];
    const mail = { failures: 0 };
    const withStripe = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.startsWith('https://api.resend.com/')) {
            if (mail.failures > 0) {
                mail.failures -= 1;
                return new Response(JSON.stringify({ message: 'injected failure' }), { status: 500 });
            }
            emails.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ id: `email_${emails.length}` }), { status: 200 });
        }
        return withStripe(input, init);
    };

    const users = new Map();   // access token → Supabase user
    const handlers = new Map();
    const config = vercelConfig();
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;

    Object.assign(process.env, {
        SUPABASE_URL: origin,
        SUPABASE_ANON_KEY: 'anon-key-for-tests',
        SUPABASE_SERVICE_ROLE_KEY: signJwt({ role: 'service_role', iss: 'supabase' }),
        STRIPE_SECRET_KEY: 'sk_test_double',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_double',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        VOID_SHIP_HU_STANDARD: '990',
        VOID_SHIP_EU_STANDARD: '1490',
        VOID_ADMIN_EMAILS: 'owner@eternalvoid.co',
        VOID_SITE_URL: origin,
        RESEND_API_KEY: 're_test_double',
        ...env
    });

    async function apiHandler(pathname) {
        const file = path.join(ROOT, 'api', `${pathname.replace(/^\/api\//, '')}.js`);
        if (!fs.existsSync(file) || path.basename(file).startsWith('_')) return null;
        if (!handlers.has(file)) handlers.set(file, await import(pathToFileURL(file).href));
        return handlers.get(file);
    }

    const server = http.createServer(async (req, res) => {
        augment(res);
        const url = new URL(req.url, origin);
        try {
            // Supabase gateway: REST
            if (url.pathname.startsWith('/rest/v1/')) {
                const body = await readBody(req);
                const headers = {};
                ['authorization', 'prefer', 'content-type', 'accept'].forEach((h) => { if (req.headers[h]) headers[h] = req.headers[h]; });
                const upstream = await fetch(`${rest.url}${url.pathname.slice('/rest/v1'.length)}${url.search}`, {
                    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
                });
                res.statusCode = upstream.status;
                const type = upstream.headers.get('content-type');
                if (type) res.setHeader('Content-Type', type);
                return res.end(await upstream.text());
            }
            // Supabase gateway: who is this token?
            if (url.pathname === '/auth/v1/user') {
                const token = (req.headers.authorization || '').replace(/^Bearer /, '');
                const user = users.get(token);
                return user ? res.status(200).json(user) : res.status(401).json({ msg: 'invalid token' });
            }

            if (url.pathname.startsWith('/api/')) {
                const mod = await apiHandler(url.pathname);
                if (!mod) return res.status(404).json({ error: 'not_found' });
                req.query = Object.fromEntries(url.searchParams);
                const raw = mod.config && mod.config.api && mod.config.api.bodyParser === false;
                if (!raw) {
                    const text = await readBody(req);
                    const type = req.headers['content-type'] || '';
                    if (type.includes('application/json') && text) req.body = JSON.parse(text);
                    else if (type.includes('application/x-www-form-urlencoded')) req.body = Object.fromEntries(new URLSearchParams(text));
                    else req.body = text || undefined;
                }
                return await mod.default(req, res);
            }

            // Static files, with vercel.json's exact-match rewrites.
            let pathname = decodeURIComponent(url.pathname);
            const rewrite = (config.rewrites || []).find((r) => r.source === pathname);
            if (rewrite) pathname = rewrite.destination;
            let file = path.join(ROOT, pathname);
            if (!file.startsWith(ROOT)) return res.status(403).end();
            if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
            if (!fs.existsSync(file)) return res.status(404).end('not found');
            res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
            const csp = config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy');
            if (file.endsWith('.html') && csp) res.setHeader('Content-Security-Policy', csp.value);
            return res.end(fs.readFileSync(file));
        } catch (error) {
            console.error('dev server error', error);
            if (!res.headersSent) res.status(500).json({ error: 'dev_server_error' });
            else res.end();
        }
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

    // ── helpers the tests use ───────────────────────────────────────────────
    async function api(method, route, body, headers = {}) {
        const res = await fetch(`${origin}${route}`, {
            method,
            headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        return { status: res.status, data, headers: res.headers };
    }

    async function deliver(type, snapshot, opts) {
        const { payload, signature } = stripe.event(type, snapshot, opts);
        const res = await fetch(`${origin}/api/stripe-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
            body: payload
        });
        return { status: res.status, data: await res.json(), eventId: JSON.parse(payload).id, payload, signature };
    }

    async function redeliver(delivery) {
        const res = await fetch(`${origin}/api/stripe-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Stripe-Signature': delivery.signature },
            body: delivery.payload
        });
        return { status: res.status, data: await res.json() };
    }

    function addUser({ email, confirmed = true }) {
        const token = crypto.randomBytes(16).toString('hex');
        users.set(token, {
            id: crypto.randomUUID(),
            email,
            email_confirmed_at: confirmed ? new Date().toISOString() : null
        });
        return token;
    }

    async function stock(variantId) {
        const { rows } = await db.query('select on_hand, reserved, sold, returned from inventory_items where variant_id = $1', [variantId]);
        const r = rows[0];
        return { onHand: r.on_hand, reserved: r.reserved, available: r.on_hand - r.reserved, sold: r.sold, returned: r.returned };
    }

    async function setStock(variantId, onHand) {
        await db.query('update inventory_items set on_hand = $2 where variant_id = $1', [variantId, onHand]);
    }

    async function stop() {
        globalThis.fetch = withStripe;
        stripe.uninstall();
        await new Promise((resolve) => server.close(resolve));
        server.closeAllConnections?.();
        rest.proc.kill();
        await db.end();
        await dropDatabase(dbName).catch(() => {});
        fs.rmSync(rest.conf, { force: true });
    }

    return { origin, db, dbName, stripe, emails, mail, api, deliver, redeliver, addUser, stock, setStock, stop, signJwt, restUrl: rest.url };
}

// A complete, valid checkout body for the given lines.
export function checkoutBody(items, overrides = {}) {
    return {
        items,
        email: 'client@example.com',
        firstName: 'Ada',
        lastName: 'Void',
        shippingMethodId: 'hu-standard',
        shippingAddress: {
            firstName: 'Ada', lastName: 'Void', line1: 'Andrássy út 1', city: 'Budapest', postalCode: '1061', country: 'HU'
        },
        ...overrides
    };
}

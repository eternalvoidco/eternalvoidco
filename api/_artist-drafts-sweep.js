// ─────────────────────────────────────────────────────────────────────────────
// /api/artist-drafts-sweep — clears submissions whose upload never landed.
//
// A submission is a draft between the metadata being recorded and storage
// confirming the file arrived. Most close in seconds. The ones that do not —
// a browser closed mid-upload, a connection lost, a confirm call that never
// came back — would otherwise sit forever: invisible to reviewers, but holding
// an artist's name and email, and sometimes an orphaned object beside them.
//
// This removes both, together, so neither can outlive the other. That is the
// promise the Privacy Notice makes under "an incomplete submission whose
// upload never finished": deleted, with its file, within 24 hours.
//
// Order matters. The rows are deleted first and their paths returned; the
// objects go afterwards. An object left behind by a failed delete is invisible
// and unreferenced and the next sweep will not find it, so it is logged loudly
// rather than swallowed — a known gap with a name beats a silent one.
//
// Called by the Vercel cron (see vercel.json). Authorised by CRON_SECRET, or
// by an administrator running it by hand.
// ─────────────────────────────────────────────────────────────────────────────
import { requireAdmin } from './_auth.js';
import { artistsConfigured, removeObject, rpc, describeSupabaseError } from './_artists.js';

const OLDER_THAN = process.env.VOID_ARTIST_DRAFT_TTL || '24 hours';

function cronAuthorised(request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const header = String((request.headers && request.headers.authorization) || '');
    return header === `Bearer ${secret}`;
}

export default async function handler(request, response) {
    if (!artistsConfigured()) {
        return response.status(503).json({ ok: false, error: 'not_configured' });
    }

    let actor = null;
    if (cronAuthorised(request)) {
        actor = 'cron';
    } else {
        const gate = await requireAdmin(request);
        if (!gate.ok) {
            // Said plainly rather than silently allowed: a sweep nobody is
            // authorised to run is a retention promise nobody is keeping.
            if (!process.env.CRON_SECRET) {
                console.error('artist-drafts-sweep: CRON_SECRET is not set, so the scheduled sweep cannot authenticate');
            }
            return response.status(gate.status).json({ ok: false, error: gate.error });
        }
        actor = gate.user.email;
    }

    response.setHeader('Cache-Control', 'no-store');

    let swept;
    try {
        swept = await rpc('artist_submissions_sweep_drafts', { p_older_than: OLDER_THAN }, 'sweep drafts');
    } catch (error) {
        console.error(describeSupabaseError(error, 'artist-drafts-sweep: sweep'));
        return response.status(502).json({ ok: false, error: 'upstream_failed' });
    }

    const paths = (swept && swept.paths) || [];
    const stranded = [];
    for (const path of paths) {
        try {
            await removeObject(path);
        } catch (error) {
            // The row is already gone, so nothing points at this object any
            // more and no later sweep will find it. Named in the log so it can
            // be removed by hand.
            console.error('artist-drafts-sweep: object left behind —', path, error && error.message);
            stranded.push(path);
        }
    }

    return response.status(200).json({
        ok: true,
        actor,
        olderThan: OLDER_THAN,
        draftsRemoved: paths.length,
        filesRemoved: paths.length - stranded.length,
        strandedFiles: stranded
    });
}

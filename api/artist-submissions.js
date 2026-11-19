// ─────────────────────────────────────────────────────────────────────────────
// /api/artist-submissions — the reviewer's queue. Admin only.
//
//   GET    ?status=…           the queue, with counts. Drafts are never in it.
//   GET    ?file=<reference>   a signed link to one submission's file, valid
//                              for five minutes.
//   PATCH  { reference, status, note }
//                              move a submission, optionally leaving a private
//                              note. Every move is written to the audit trail
//                              with the reviewer's address.
//   DELETE { reference }       the withdrawal procedure: delete the object,
//                              then clear the file record and mark the
//                              submission withdrawn.
//
// requireAdmin is the same check the inventory dashboard uses: a valid
// Supabase session, a confirmed address, and membership of VOID_ADMIN_EMAILS.
// Nothing in a request body is ever taken as an identity or a role.
// ─────────────────────────────────────────────────────────────────────────────
import { requireAdmin } from './_auth.js';
import {
    artistsConfigured, signDownload, removeObject, rpc, describeSupabaseError
} from './_artists.js';

const STATUSES = ['received', 'under_review', 'shortlisted', 'declined', 'withdrawn'];

export default async function handler(request, response) {
    const gate = await requireAdmin(request);
    if (!gate.ok) {
        return response.status(gate.status).json({ ok: false, error: gate.error });
    }
    if (!artistsConfigured()) {
        return response.status(503).json({ ok: false, error: 'not_configured' });
    }

    // Never cached and never indexed: this is unpublished work belonging to
    // people who have not signed anything.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');

    try {
        if (request.method === 'GET') return await read(request, response);
        if (request.method === 'PATCH') return await move(request, response, gate.user.email);
        if (request.method === 'DELETE') return await withdraw(request, response, gate.user.email);
    } catch (error) {
        console.error(describeSupabaseError(error, 'artists: admin ' + request.method));
        return response.status(502).json({ ok: false, error: 'upstream_failed' });
    }

    response.setHeader('Allow', 'GET, PATCH, DELETE');
    return response.status(405).json({ ok: false, error: 'method_not_allowed' });
}

async function read(request, response) {
    const url = new URL(request.url, 'http://local');
    const wanted = url.searchParams.get('file');

    // ── one file, briefly ────────────────────────────────────────────────
    if (wanted) {
        const list = await rpc('artist_submissions_list', { p_status: null, p_limit: 500, p_offset: 0 });
        const row = (list.rows || []).find((r) => r.reference === wanted);
        if (!row) return response.status(404).json({ ok: false, error: 'not_found' });
        if (!row.file_path || row.file_state !== 'stored') {
            return response.status(409).json({ ok: false, error: 'no_file' });
        }
        // Minutes, not hours. Long enough to open a PDF; short enough that a
        // URL pasted into a chat is worthless by the time anyone finds it.
        const link = await signDownload(row.file_path, 300);
        return response.status(200).json({ ok: true, url: link, expiresIn: 300, name: row.file_name });
    }

    // ── the queue ────────────────────────────────────────────────────────
    const status = url.searchParams.get('status') || '';
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

    const data = await rpc('artist_submissions_list', {
        p_status: STATUSES.includes(status) ? status : null,
        p_limit: limit,
        p_offset: offset
    });

    // The storage path is an internal detail; the queue reaches a file through
    // ?file=<reference>, which checks for an admin every time.
    const rows = (data.rows || []).map((row) => {
        const copy = Object.assign({}, row);
        delete copy.file_path;
        return copy;
    });

    return response.status(200).json({ ok: true, counts: data.counts || {}, rows });
}

async function move(request, response, actor) {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : '';

    if (!reference) return response.status(400).json({ ok: false, error: 'missing_reference' });
    if (!STATUSES.includes(status)) return response.status(400).json({ ok: false, error: 'bad_status' });

    const moved = await rpc('artist_submission_set_status', {
        p_reference: reference, p_status: status, p_actor: actor, p_note: note || null
    });
    if (!moved || !moved.ok) {
        return response.status(404).json({ ok: false, error: (moved && moved.error) || 'not_found' });
    }

    // Withdrawing is not only a status. The files go too, in the order that
    // cannot leave an unreachable object behind: delete first, record second.
    if (status === 'withdrawn' && moved.filePath && moved.fileState === 'stored') {
        try {
            await removeObject(moved.filePath);
            await rpc('artist_submission_mark_files_deleted', { p_reference: reference, p_actor: actor });
            moved.filesDeleted = true;
        } catch (error) {
            // The status stands and the object is still there; the row still
            // points at it, so this is retryable rather than lost.
            console.error('artists: withdrawal delete failed', error && error.message);
            moved.filesDeleted = false;
        }
    }

    return response.status(200).json({ ok: true, submission: moved });
}

async function withdraw(request, response, actor) {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference) return response.status(400).json({ ok: false, error: 'missing_reference' });

    return move(
        Object.assign({}, request, { body: { reference, status: 'withdrawn', note: body.note || 'withdrawn on request' } }),
        response,
        actor
    );
}

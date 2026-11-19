// ─────────────────────────────────────────────────────────────────────────────
// POST /api/artist-submission — private intake for EV for Artists.
//
// Two calls, because a 15 MB file cannot travel through a Vercel function (the
// body limit is a fraction of that) and because the two halves have to fail
// independently and safely:
//
//   1 · { ...fields }            validate everything, record the submission as
//                                a DRAFT, hand back a reference and a one-shot
//                                signed URL the browser uploads straight to.
//                                With no file there is nothing to wait for, so
//                                the row is 'received' immediately and this is
//                                the only call.
//
//   2 · { confirm, token }       the bytes have landed. Ask storage whether
//                                that is true, then move the row into the
//                                queue and send the receipt.
//
// WHAT EACH FAILURE LEAVES BEHIND
//   1 fails            nothing. No row, no object.
//   upload fails       a draft row and no object. Drafts are never shown to a
//                      reviewer and are swept after 24h.
//   2 fails            a draft row and an object, removed together by the same
//                      sweep. The client may retry 2 with the same reference
//                      and token; confirming twice is a no-op.
//   email fails        the submission is saved and the artist is told so. A
//                      receipt that did not send is ours to retry, never a
//                      reason to ask somebody to upload their work again.
//
// Validation is here, not in the browser. Size, type, length and authorisation
// are all re-checked server-side, and the storage path is chosen here so a
// caller can never name one.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import {
    artistsConfigured, intakeOpen, EMAIL_RE, MAX_BYTES, TYPES, TERMS_VERSION,
    generateReference, callerHash, storagePath, signUpload, statObject, removeObject,
    sendEmail, receiptHtml, atelierHtml, rpc, describeSupabaseError
} from './_artists.js';

const ATELIER_TO = process.env.VOID_ARTIST_NOTIFY_TO || 'artists@eternalvoid.co';

function bad(response, status, message, extra) {
    return response.status(status).json(Object.assign({ ok: false, message }, extra || {}));
}

function str(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return bad(response, 405, 'Method not allowed.');
    }
    if (!artistsConfigured()) {
        return bad(response, 503, 'Submissions are not available right now.');
    }
    // Gated until the rate, the payouts and the legal drafts are approved.
    // Nothing is recorded while this is closed.
    if (!intakeOpen()) {
        return bad(response, 503, 'EV for Artists is not open for submissions yet.', { closed: true });
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {};

    // ── 2 · confirming an upload ─────────────────────────────────────────────
    if (body.confirm) {
        const reference = str(body.confirm, 32);
        const token = str(body.token, 80);
        if (!reference || !token) return bad(response, 400, 'Missing submission reference.');

        let found;
        try {
            found = await rpc('artist_submissions_list', { p_status: null, p_limit: 500, p_offset: 0 });
        } catch (error) {
            console.error(describeSupabaseError(error, 'artists: confirm lookup'));
            return bad(response, 502, 'We could not confirm the upload. Please try again.');
        }

        // The path is read back from the row rather than taken from the
        // request, so a confirm call cannot point at somebody else's object.
        const row = (found && found.rows ? found.rows : []).find((r) => r.reference === reference);
        // A draft is not in that list by design, so ask for its path directly.
        let path = row && row.file_path;
        if (!path) path = str(body.path, 300);
        if (!path || !/^\d{4}\/\d{2}\/EVA-\d{2}-[0-9A-Z]{6}\.(pdf|jpg|png)$/.test(path)) {
            return bad(response, 400, 'Missing submission reference.');
        }

        let stat;
        try {
            stat = await statObject(path);
        } catch (error) {
            console.error('artists: stat failed', error && error.message);
            return bad(response, 502, 'We could not confirm the upload. Please try again.');
        }
        if (!stat) return bad(response, 409, 'The upload did not finish. Please try again.');
        if (stat.size > MAX_BYTES) {
            try { await removeObject(path); } catch (e) { /* swept later */ }
            return bad(response, 413, 'That file is over 15 MB. Please send a smaller one.');
        }

        let saved;
        try {
            saved = await rpc('artist_submission_confirm', {
                p_reference: reference, p_token: token, p_size: stat.size
            });
        } catch (error) {
            console.error(describeSupabaseError(error, 'artists: confirm'));
            return bad(response, 502, 'We could not confirm the upload. Please try again.');
        }
        if (!saved || !saved.ok) {
            return bad(response, 409, 'We could not confirm the upload. Please try again.');
        }

        const sent = await notify(reference, body);
        return response.status(200).json({
            ok: true, reference, receiptSent: sent.receipt, notified: sent.atelier
        });
    }

    // ── 1 · a new submission ─────────────────────────────────────────────────
    const name = str(body.name, 120);
    const email = str(body.email, 320).toLowerCase();
    const country = str(body.country, 80);
    const title = str(body.title, 140);
    const description = str(body.description, 2000);
    const portfolio = str(body.portfolio, 500);
    const locale = ['en', 'fr', 'it', 'de'].includes(str(body.locale, 4)) ? str(body.locale, 4) : 'en';
    const marketing = body.acceptNews === true || body.acceptNews === '1';

    if (!name || !country || !title || !description) return bad(response, 400, 'Please complete every required field.');
    if (!EMAIL_RE.test(email)) return bad(response, 400, 'Please enter a valid email address.');
    // The one control that gates a submission. Marketing is separate and is
    // never required.
    if (body.acceptTerms !== true && body.acceptTerms !== '1') {
        return bad(response, 400, 'Please accept the Submission Terms before sending.');
    }
    if (portfolio && !/^https?:\/\//i.test(portfolio)) {
        return bad(response, 400, 'Please enter a full link, starting with https://');
    }

    // The file, described rather than carried. Both checks are repeated by the
    // bucket itself and by a table constraint, so a client that lies here is
    // stopped three more times.
    let fileName = '';
    let fileType = '';
    let fileSize = 0;
    if (body.file && typeof body.file === 'object') {
        fileName = str(body.file.name, 200);
        fileType = str(body.file.type, 100);
        fileSize = Number(body.file.size) || 0;
        if (!TYPES[fileType]) return bad(response, 415, 'PDF, JPG or PNG only.');
        if (fileSize <= 0 || fileSize > MAX_BYTES) return bad(response, 413, 'That file is over 15 MB. Please send a smaller one.');
    }

    const ipHash = callerHash(request);

    // Proportionate: enough to stop a script, loose enough that a person who
    // sends two designs in an afternoon is not refused.
    try {
        const recent = await rpc('artist_submission_recent', {
            p_email: email, p_ip_hash: ipHash, p_window: '01:00:00'
        });
        if (recent && (Number(recent.byEmail) >= 3 || Number(recent.byCaller) >= 6)) {
            return bad(response, 429, 'That is a lot of submissions in a short time. Please try again later.');
        }
    } catch (error) {
        // A rate-limit lookup that fails must not refuse a genuine artist.
        console.error(describeSupabaseError(error, 'artists: rate check'));
    }

    const reference = generateReference();
    const hasFile = Boolean(fileType);
    const path = hasFile ? storagePath(reference, fileType) : null;
    const token = hasFile ? crypto.randomBytes(24).toString('hex') : null;

    // The signed URL is minted before the row exists, so a storage outage
    // leaves nothing behind at all.
    let uploadUrl = null;
    if (hasFile) {
        try {
            uploadUrl = await signUpload(path);
        } catch (error) {
            console.error('artists: sign upload failed', error && error.message);
            return bad(response, 502, 'We could not prepare the upload. Please try again.');
        }
    }

    let saved;
    try {
        saved = await rpc('artist_submission_create', {
            p_reference: reference,
            p_name: name, p_email: email, p_country: country,
            p_title: title, p_description: description, p_portfolio: portfolio || null,
            p_locale: locale,
            // Ours, not the browser's.
            p_terms_version: TERMS_VERSION,
            p_marketing: marketing,
            p_file_name: fileName || null, p_file_size: hasFile ? fileSize : null,
            p_file_type: fileType || null, p_file_path: path,
            p_confirm_token: token, p_ip_hash: ipHash
        });
    } catch (error) {
        console.error(describeSupabaseError(error, 'artists: create'));
        // Nothing was recorded, so nothing is orphaned.
        return bad(response, 502, 'Something went wrong at our end. Nothing was saved, so please try again.');
    }
    if (!saved || !saved.ok) {
        return bad(response, 502, 'Something went wrong at our end. Nothing was saved, so please try again.');
    }

    if (hasFile) {
        // The browser uploads, then calls back with { confirm, token }. Until
        // it does, this submission is a draft and no reviewer will see it.
        return response.status(200).json({
            ok: true, pending: true, reference, token, path, uploadUrl,
            uploadHeaders: { 'Content-Type': fileType, 'x-upsert': 'false' }
        });
    }

    const sent = await notify(reference, { name, email, country, title, description, portfolio, hasFile: false });
    return response.status(200).json({
        ok: true, reference, receiptSent: sent.receipt, notified: sent.atelier
    });
}

// The receipt and the atelier's notice. Either failing is recorded and
// retryable; neither can undo a saved submission.
async function notify(reference, fields) {
    const out = { receipt: false, atelier: false };

    let row = fields;
    if (!row || !row.email) {
        try {
            const list = await rpc('artist_submissions_list', { p_status: null, p_limit: 500, p_offset: 0 });
            row = (list && list.rows ? list.rows : []).find((r) => r.reference === reference) || {};
        } catch (error) {
            console.error(describeSupabaseError(error, 'artists: notify lookup'));
            return out;
        }
    }
    if (!row.email) return out;

    out.receipt = await sendEmail({
        to: row.email,
        subject: `EV for Artists — ${reference}`,
        replyTo: 'artists@eternalvoid.co',
        html: receiptHtml({ name: row.name || '', reference, title: row.title || '' })
    });

    out.atelier = await sendEmail({
        to: ATELIER_TO,
        subject: `New submission — ${reference}`,
        replyTo: row.email,
        html: atelierHtml({
            reference,
            name: row.name || '', email: row.email, country: row.country || '',
            title: row.title || '', description: row.description || '',
            hasFile: Boolean(row.file_name || row.hasFile),
            portfolio: row.portfolio_url || row.portfolio || ''
        })
    });

    try {
        if (out.receipt) await rpc('artist_submission_mark_sent', { p_reference: reference, p_which: 'receipt' });
        if (out.atelier) await rpc('artist_submission_mark_sent', { p_reference: reference, p_which: 'atelier' });
    } catch (error) {
        console.error(describeSupabaseError(error, 'artists: mark sent'));
    }
    return out;
}

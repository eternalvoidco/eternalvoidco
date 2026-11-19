import submit from './_artist-submission.js';
import submissions from './_artist-submissions.js';
import royalties from './_artist-royalties.js';
import reversals from './_artist-reversals.js';
import sweep from './_artist-drafts-sweep.js';

const handlers = new Map([
    ['/api/artist-submission', submit],
    ['/api/artist-submissions', submissions],
    ['/api/artist-royalties', royalties],
    ['/api/artist-reversals', reversals],
    ['/api/artist-drafts-sweep', sweep],
]);

export default function handler(request, response) {
    const { pathname, searchParams } = new URL(request.url, 'http://local');
    // Vercel may expose the original request path or the rewrite destination.
    const routes = searchParams.getAll('_ev_artist_route');
    const route = pathname === '/api/artists' && routes.length === 1
        ? routes[0]
        : pathname;
    const handle = handlers.get(route);
    if (!handle) return response.status(404).json({ error: 'Not found' });
    return handle(request, response);
}

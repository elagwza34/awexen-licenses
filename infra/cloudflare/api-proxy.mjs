// One public origin for the panel and API; the legacy API host remains available.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname !== 'licenses.awexen.com' || !url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }
    const upstream = new URL(url);
    upstream.hostname = 'api.awexen.com';
    upstream.protocol = 'https:';
    upstream.port = '';
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('X-Forwarded-Host', url.hostname);
    headers.set('X-Forwarded-Proto', 'https');
    const clientIp = request.headers.get('CF-Connecting-IP');
    if (clientIp) headers.set('X-Forwarded-For', clientIp);
    try {
      const response = await fetch(upstream, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        cache: 'no-store',
      });
      const result = new Response(response.body, response);
      result.headers.set('Cache-Control', 'private, no-store');
      const location = result.headers.get('Location');
      if (location?.startsWith('https://api.awexen.com/')) {
        result.headers.set('Location', location.replace('https://api.awexen.com', url.origin));
      }
      return result;
    } catch {
      console.error(JSON.stringify({ event: 'api_upstream_unavailable' }));
      return Response.json({ message: 'API temporarily unavailable' }, { status: 502 });
    }
  },
};

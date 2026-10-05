/**
 * Netlify Serverless Function: CORS proxy
 * Path: /.netlify/functions/proxy?url=<encoded-url>
 *
 * Fetches any URL server-side (no browser CORS restrictions)
 * and returns the response with CORS headers added.
 * Only allows GET requests to HTTPS endpoints.
 */
export default async (request, context) => {
  // Only allow GET
  if (request.method !== 'GET' && request.method !== 'OPTIONS') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders('application/json'),
    });
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const reqUrl = new URL(request.url);
  const targetUrl = reqUrl.searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing "url" query parameter' }), {
      status: 400,
      headers: corsHeaders('application/json'),
    });
  }

  // Validate it's an HTTPS URL (security: don't allow internal network access)
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: corsHeaders('application/json'),
    });
  }

  if (parsed.protocol !== 'https:') {
    return new Response(JSON.stringify({ error: 'Only HTTPS URLs are allowed' }), {
      status: 400,
      headers: corsHeaders('application/json'),
    });
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: request.headers.get('accept') || '*/*',
        'User-Agent': 'DeployWatcher/1.0',
      },
      // 10 second timeout via signal
      signal: AbortSignal.timeout(10000),
    });

    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(contentType),
        'X-Proxied-Status': String(upstream.status),
        'X-Proxied-Url': targetUrl,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed', message: err.message }), {
      status: 502,
      headers: corsHeaders('application/json'),
    });
  }
};

function corsHeaders(contentType) {
  const h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Cache-Control': 'no-store',
  };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

export const config = {
  path: '/api/proxy',  // Also intercepts /api/proxy so Vite-style URL works on Netlify too
};

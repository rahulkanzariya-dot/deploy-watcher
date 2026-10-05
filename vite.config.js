import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function corsProxyPlugin() {
  const handler = async (req, res, next) => {
    if (req.url && req.url.startsWith('/api/proxy')) {
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const targetUrl = parsedUrl.searchParams.get('url');
        if (!targetUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing "url" query parameter' }));
          return;
        }

        const fetchHeaders = {};
        if (req.headers['authorization']) {
          fetchHeaders['Authorization'] = req.headers['authorization'];
        }
        if (req.headers['accept']) {
          fetchHeaders['Accept'] = req.headers['accept'];
        }

        const response = await fetch(targetUrl, {
          headers: fetchHeaders,
        });

        res.statusCode = response.status;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        const contentType = response.headers.get('content-type');
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }

        const arrayBuffer = await response.arrayBuffer();
        res.end(Buffer.from(arrayBuffer));
      } catch (err) {
        res.statusCode = 502;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Proxy request failed', message: err.message }));
      }
      return;
    }
    next();
  };

  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), corsProxyPlugin()],
  server: {
    port: 5174
  }
})


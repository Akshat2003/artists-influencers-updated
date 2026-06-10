import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only plugin: runs the /api serverless functions inside the Vite dev
// server, so `npm run dev` serves BOTH the UI and the API (no Vercel CLI
// needed locally). In production on Vercel, the real /api functions are used
// and this plugin is not involved.
function devApi(env) {
  return {
    name: 'dev-api',
    configureServer(server) {
      // Make .env values available to the API handler via process.env.
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }

      server.middlewares.use('/api/entries', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const query = Object.fromEntries(url.searchParams.entries());

          // Collect the request body.
          let body = {};
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const raw = Buffer.concat(chunks).toString('utf8');
            body = raw ? JSON.parse(raw) : {};
          }

          // Minimal Vercel-style req/res shims.
          const vReq = { method: req.method, query, body, headers: req.headers };
          const vRes = {
            statusCode: 200,
            status(code) {
              this.statusCode = code;
              return this;
            },
            setHeader(k, v) {
              res.setHeader(k, v);
              return this;
            },
            json(obj) {
              res.statusCode = this.statusCode;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(obj));
            },
          };

          // Import fresh so edits to the handler are picked up.
          const mod = await server.ssrLoadModule('/api/entries.js');
          await mod.default(vReq, vRes);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[dev-api] error:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Dev API error. Check the terminal.' }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env (all keys, not just VITE_*) so the dev API can read MONGODB_URI.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), devApi(env)],
    server: {
      port: 3000,
    },
  };
});

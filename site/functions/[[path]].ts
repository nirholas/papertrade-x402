import { createApp } from '../../src/app.js';
import type { Env } from '../../src/config.js';
import { CORS_HEADERS } from './_lib/mcp.js';
import { WELL_KNOWN_TYPES, wellKnownBody } from './_lib/agent-docs.js';

const app = createApp();

export const onRequest: PagesFunction<Env> = (context) => {
  const url = new URL(context.request.url);
  const type = WELL_KNOWN_TYPES[url.pathname];
  if (type && (context.request.method === 'GET' || context.request.method === 'HEAD')) {
    const body = wellKnownBody(url.pathname, url.origin);
    return new Response(context.request.method === 'HEAD' ? null : JSON.stringify(body, null, 2), {
      headers: { ...CORS_HEADERS, 'Content-Type': type, 'Cache-Control': 'public, max-age=300' },
    });
  }
  return app.fetch(context.request, context.env);
};

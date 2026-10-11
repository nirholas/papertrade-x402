import { activeNetworks, VERSION, type ResolvedConfig } from './config.js';
import { PAID_ENDPOINTS } from './endpoints.js';

type Json = Record<string, unknown>;

function parametersFor(path: string, schema: Json): Json[] {
  const props = (schema.properties ?? {}) as Record<string, Json>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(props).map(([name, s]) => ({
    name,
    in: path.includes(`{${name}}`) ? 'path' : 'query',
    required: path.includes(`{${name}}`) || required.has(name),
    schema: s,
    ...(typeof s.description === 'string' ? { description: s.description } : {}),
  }));
}

export function buildOpenApi(config: ResolvedConfig, origin: string) {
  const paths: Record<string, Json> = {
    '/api/v1/health': {
      get: { summary: 'Service health', tags: ['free'], responses: { '200': { description: 'Status of the API, the Papertrade upstream and x402 configuration' } } },
    },
    '/api/v1/markets': {
      get: { summary: 'Live instruments and mark prices', tags: ['free'], responses: { '200': { description: 'Instruments with mark price, limits and open interest' } } },
    },
  };
  for (const e of PAID_ENDPOINTS) {
    const op: Json = {
      operationId: e.id.replace(/-/g, '_'),
      summary: e.summary,
      description: e.description,
      tags: ['paid'],
      'x-payment-info': {
        price: { mode: 'fixed', currency: 'USD', amount: config.prices[e.id] },
        protocols: [{ x402: {} }],
      },
      responses: {
        '200': { description: 'Result', content: { 'application/json': { schema: e.outputSchema } } },
        '400': { description: 'Invalid input (not charged)' },
        '402': { description: 'Payment required. The PAYMENT-REQUIRED header carries the base64 x402 v2 requirements.' },
        '502': { description: 'Papertrade upstream unavailable (not charged)' },
        '503': { description: 'Payment addresses are not configured on this deployment' },
      },
    };
    if (e.method === 'POST') op.requestBody = { required: true, content: { 'application/json': { schema: e.inputSchema, example: e.inputExample } } };
    else op.parameters = parametersFor(e.path, e.inputSchema);
    paths[e.path] = { [e.method.toLowerCase()]: op };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'papertrade-x402',
      version: VERSION,
      description: `Unofficial pay-per-call Papertrade intelligence API (x402). Networks: ${activeNetworks(config).map((n) => n.network).join(', ') || 'none configured'}. Not affiliated with Papertrade.`,
      license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    },
    servers: [{ url: origin }],
    paths,
  };
}

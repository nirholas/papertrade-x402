import { HTTPFacilitatorClient, x402ResourceServer, type RouteConfig, type RoutesConfig } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { paymentMiddleware } from '@x402/hono';
import type { MiddlewareHandler } from 'hono';
import { SOLANA_MAINNET, activeNetworks, type ResolvedConfig } from './config.js';
import { PAID_ENDPOINTS, type PaidEndpoint } from './endpoints.js';

const MAX_TIMEOUT_SECONDS = 90;

/** Bazaar discovery metadata for one endpoint, so facilitators can catalog it. */
function discoveryFor(e: PaidEndpoint) {
  const output = { schema: e.outputSchema };
  if (e.method === 'POST') {
    return declareDiscoveryExtension({ bodyType: 'json', input: e.inputExample, inputSchema: e.inputSchema, output });
  }
  const pathParam = e.path.includes('{');
  return declareDiscoveryExtension({
    ...(pathParam ? { pathParams: e.inputExample, pathParamsSchema: e.inputSchema } : { input: e.inputExample, inputSchema: e.inputSchema }),
    output,
  });
}

/** x402 route table: every paid endpoint, one `accepts` entry per configured network (Solana first). */
export function buildRoutes(config: ResolvedConfig): Record<string, RouteConfig> {
  const networks = activeNetworks(config);
  const routes: Record<string, RouteConfig> = {};
  for (const e of PAID_ENDPOINTS) {
    routes[e.routePattern] = {
      accepts: networks.map((n) => ({
        scheme: 'exact',
        network: n.network,
        payTo: n.payTo as string,
        price: `$${config.prices[e.id]}`,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      })),
      description: e.description,
      mimeType: 'application/json',
      serviceName: 'papertrade-x402',
      tags: e.tags,
      unpaidResponseBody: () => ({
        contentType: 'application/json',
        body: {
          error: 'payment_required',
          message: `${e.summary} costs ${config.prices[e.id]} USDC per call. Pay via x402 (PAYMENT-SIGNATURE header) on ${networks.map((n) => n.label).join(' or ')}.`,
          discovery: '/.well-known/x402',
          openapi: '/openapi.json',
        },
      }),
      extensions: discoveryFor(e),
    };
  }
  return routes;
}

export function buildResourceServer(config: ResolvedConfig): x402ResourceServer {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl }));
  for (const n of activeNetworks(config)) {
    server.register(n.network, n.network === SOLANA_MAINNET ? new ExactSvmScheme() : new ExactEvmScheme());
  }
  server.registerExtension(bazaarResourceServerExtension);
  return server;
}

const cache = new Map<string, MiddlewareHandler>();

/**
 * One payment middleware per distinct configuration, reused across requests in the same isolate so the
 * facilitator `/supported` sync happens once, not on every call.
 */
export function paymentMiddlewareFor(config: ResolvedConfig): MiddlewareHandler {
  const key = JSON.stringify([config.facilitatorUrl, config.networks.map((n) => n.payTo), config.prices]);
  let mw = cache.get(key);
  if (!mw) {
    mw = paymentMiddleware(buildRoutes(config) as RoutesConfig, buildResourceServer(config));
    cache.set(key, mw);
  }
  return mw;
}

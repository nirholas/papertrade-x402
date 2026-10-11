import { VERSION } from '../../../src/config.js';
import { INSTRUCTIONS, TOOLS } from './papertrade-mcp.js';
import { SUPPORTED_PROTOCOLS, describeTools } from './mcp.js';

/** Machine-readable discovery documents for agents, all derived from the live tool list so they cannot drift. */

const DESCRIPTION =
  'Unofficial pay-per-call intelligence over Papertrade (1000x synthetic perps on Hyperliquid HyperEVM): free live markets and previews, plus paid x402 endpoints for wallet liquidation risk, liquidation maps, settlement estimates and top-trader stats. Not affiliated with Papertrade.';

export const WELL_KNOWN_TYPES: Record<string, string> = {
  '/.well-known/mcp/server-card.json': 'application/json; charset=utf-8',
  '/.well-known/mcp.json': 'application/json; charset=utf-8',
  '/.well-known/agent-card.json': 'application/json; charset=utf-8',
  '/.well-known/agent.json': 'application/json; charset=utf-8',
  '/.well-known/api-catalog': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
};

export function buildServerCard(origin: string) {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: SUPPORTED_PROTOCOLS[0],
    serverInfo: { name: 'papertrade-x402', title: 'Papertrade x402 intelligence', version: VERSION },
    description: DESCRIPTION,
    documentationUrl: `${origin}/docs/mcp/`,
    transport: { type: 'streamable-http', endpoint: `${origin}/mcp` },
    capabilities: { tools: { listChanged: false } },
    authentication: { required: false, schemes: [] },
    instructions: INSTRUCTIONS,
    tools: describeTools(TOOLS),
    links: { openapi: `${origin}/openapi.json`, x402: `${origin}/.well-known/x402`, llms: `${origin}/llms.txt`, source: 'https://github.com/nirholas/papertrade-x402' },
  };
}

export function buildAgentCard(origin: string) {
  return {
    protocolVersion: '0.3.0',
    name: 'papertrade-x402',
    description: DESCRIPTION,
    url: origin,
    version: VERSION,
    documentationUrl: `${origin}/docs/`,
    provider: { organization: 'nirholas', url: 'https://github.com/nirholas' },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    supportsAuthenticatedExtendedCard: false,
    securitySchemes: {},
    interfaces: { mcp: { type: 'streamable-http', url: `${origin}/mcp`, serverCard: `${origin}/.well-known/mcp/server-card.json` }, openapi: `${origin}/openapi.json`, x402: `${origin}/.well-known/x402` },
    skills: TOOLS.map((t) => ({
      id: t.name,
      name: t.title,
      description: t.description,
      tags: ['papertrade', 'perps', 'hyperliquid', t.name.startsWith('preview_') || t.name.startsWith('get_') ? 'free' : 'x402'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    })),
  };
}

export function buildApiCatalog(origin: string) {
  return {
    linkset: [
      {
        anchor: `${origin}/api/v1/`,
        'service-desc': [{ href: `${origin}/openapi.json`, type: 'application/vnd.oai.openapi+json;version=3.1' }],
        'service-doc': [{ href: `${origin}/docs/`, type: 'text/html' }, { href: `${origin}/llms.txt`, type: 'text/plain' }],
        status: [{ href: `${origin}/api/v1/health`, type: 'application/json' }],
        item: [{ href: `${origin}/.well-known/x402`, type: 'application/json' }],
      },
      {
        anchor: `${origin}/mcp`,
        'service-desc': [{ href: `${origin}/.well-known/mcp/server-card.json`, type: 'application/json' }],
        'service-doc': [{ href: `${origin}/docs/mcp/`, type: 'text/html' }],
      },
    ],
  };
}

export function wellKnownBody(pathname: string, origin: string): unknown | null {
  switch (pathname) {
    case '/.well-known/mcp/server-card.json':
    case '/.well-known/mcp.json':
      return buildServerCard(origin);
    case '/.well-known/agent-card.json':
    case '/.well-known/agent.json':
      return buildAgentCard(origin);
    case '/.well-known/api-catalog':
      return buildApiCatalog(origin);
    default:
      return null;
  }
}

/**
 * Regenerates src/examples.json: one real response per paid endpoint, computed by the production
 * compute code from the recorded live Papertrade snapshot in test/fixtures. Arrays are cut to a few
 * items so the examples stay readable in OpenAPI, the bazaar listing and the docs.
 *
 *   npm run gen:examples
 */
import { writeFileSync } from 'node:fs';
import { computeWalletRisk } from '../src/risk.js';
import { computeEstimate, findInstrument, parseEstimateInput } from '../src/estimate.js';
import { computeLiquidationMap, parseLiquidationQuery } from '../src/liquidations.js';
import { computeTopTraders, parseTradersQuery } from '../src/traders.js';
import { PAID_ENDPOINTS } from '../src/endpoints.js';
import { live, markFor } from '../test/helpers.js';

const cut = (v: unknown, n = 2): unknown => {
  if (Array.isArray(v)) return v.slice(0, n).map((x) => cut(x, n));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x, n)]));
  return v;
};

const instruments = live.trading.instruments;
const marks = new Map(instruments.map((i) => [i.id, markFor(i)]));
const byId = Object.fromEntries(PAID_ENDPOINTS.map((e) => [e.id, e]));
const wallet = live.wallets.find((w) => w.address === byId['wallet-risk'].inputExample.address)!;
const btc = findInstrument(live.trading, 'BTC');

const board = live.board7;
const accounts = board.accounts.slice(0, 10);
const trades = new Map(accounts.map((a) => [a.address, live.trades[a.address] ?? null]));

const out = {
  'wallet-risk': computeWalletRisk({ state: wallet, instruments, marks, nowMs: live.nowMs }),
  'liquidations-nearby': computeLiquidationMap({
    query: parseLiquidationQuery(new URLSearchParams(byId['liquidations-nearby'].inputExample as Record<string, string>)),
    instrument: btc,
    mark: markFor(btc),
    wallets: live.wallets,
    protocol: live.liqMaps['0.5'],
    accountsRequested: live.wallets.length,
    nowMs: live.nowMs,
  }),
  estimate: computeEstimate({ input: parseEstimateInput(byId.estimate.inputExample), trading: live.trading, mark: markFor(btc), instrument: btc, summary: live.summary, nowMs: live.nowMs }),
  'traders-top': computeTopTraders({ query: parseTradersQuery(new URLSearchParams({ window: '7d' })), accounts, trades, totalAccounts: board.summary.uniqueAccounts, nowMs: live.nowMs }),
};

const examples = { recordedAt: live.recordedAt, note: 'Real responses computed from a recorded live Papertrade snapshot. Arrays are shortened.', examples: cut(out) };
writeFileSync(new URL('../src/examples.json', import.meta.url), `${JSON.stringify(examples, null, 2)}\n`);
console.log('wrote src/examples.json');

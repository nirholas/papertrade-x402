import { describe, expect, it } from 'vitest';
import { BASE_MAINNET, DEFAULT_PRICES, SOLANA_MAINNET, activeNetworks, parsePrice, resolveConfig } from '../src/config.js';

const SOL = '3WcepPag9Q9xsAAWsGBhBPdEmMeM3qnaR8u9FGNmTgXk';
const EVM = '0x07977F60757bad9992aFB99A57d83449B69cBC02';

describe('pricing config', () => {
  it('parses USDC amounts and rejects junk', () => {
    expect(parsePrice('0.02')).toBe('0.02');
    expect(parsePrice('$0.005')).toBe('0.005');
    expect(parsePrice('1')).toBe('1');
    for (const bad of ['', '0', '-1', 'abc', '1.1234567', '0.0.1', undefined]) expect(parsePrice(bad)).toBeNull();
  });

  it('uses wrangler vars for prices and falls back to defaults', () => {
    const c = resolveConfig({ X402_SOLANA_PAY_TO: SOL, PRICE_ESTIMATE: '0.01', PRICE_TRADERS_TOP: '$0.1' });
    expect(c.prices.estimate).toBe('0.01');
    expect(c.prices['traders-top']).toBe('0.1');
    expect(c.prices['wallet-risk']).toBe(DEFAULT_PRICES['wallet-risk']);
    expect(c.problems).toEqual([]);
  });

  it('reports invalid prices as problems without changing the default', () => {
    const c = resolveConfig({ X402_SOLANA_PAY_TO: SOL, PRICE_WALLET_RISK: 'free' });
    expect(c.prices['wallet-risk']).toBe(DEFAULT_PRICES['wallet-risk']);
    expect(c.problems.join(' ')).toContain('PRICE_WALLET_RISK');
  });
});

describe('payTo configuration', () => {
  it('is unconfigured when no address is set', () => {
    const c = resolveConfig({});
    expect(activeNetworks(c)).toEqual([]);
    expect(c.problems[0]).toContain('X402_SOLANA_PAY_TO');
  });

  it('orders Solana first and accepts Base as the second network', () => {
    const c = resolveConfig({ X402_SOLANA_PAY_TO: SOL, X402_BASE_PAY_TO: EVM });
    expect(activeNetworks(c).map((n) => n.network)).toEqual([SOLANA_MAINNET, BASE_MAINNET]);
  });

  it('works with only one network', () => {
    expect(activeNetworks(resolveConfig({ X402_BASE_PAY_TO: EVM })).map((n) => n.label)).toEqual(['base']);
  });

  it('flags a malformed address instead of using it', () => {
    const c = resolveConfig({ X402_SOLANA_PAY_TO: 'not-an-address', X402_BASE_PAY_TO: EVM });
    expect(activeNetworks(c).map((n) => n.label)).toEqual(['base']);
    expect(c.problems.join(' ')).toContain('X402_SOLANA_PAY_TO is not a valid solana address');
  });
});

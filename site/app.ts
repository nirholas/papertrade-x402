/* Landing page logic. All API strings are rendered with textContent, never innerHTML. */

type Kind = 'ok' | 'warn' | 'bad' | 'wait';

/* ?embed=1 shows just the product, for framing inside Papertrade OS. Set before first paint of the content below. */
if (new URLSearchParams(location.search).get('embed') === '1') document.documentElement.dataset.embed = '1';

interface Health {
  ok: boolean;
  upstream: { ok: boolean; indexedThroughBlock?: number; error?: string };
  x402: { configured: boolean; networks: { label: string; configured: boolean }[]; problems: string[] };
}
interface Market {
  symbol: string;
  markPrice: number;
  maxLeverage: number;
  openable: boolean;
  longOpenInterestUsd: number;
  shortOpenInterestUsd: number;
}
interface Accept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
}
interface Endpoint {
  id: string;
  method: string;
  resource: string;
  description: string;
  price: { amount: string; currency: string };
  accepts: { network: string }[];
}
interface Discovery {
  configured: boolean;
  networks: { network: string; label: string; configured: boolean }[];
  endpoints: Endpoint[];
}

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; attrs?: Record<string, string> } = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

const usd = (n: number, dp = 2) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: dp, minimumFractionDigits: dp });
const compact = (n: number) => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });

async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response (HTTP ${res.status})`);
  }
  return { status: res.status, body: body as T };
}

function setPill(id: string, kind: Kind, text: string) {
  const pill = $(id);
  pill.dataset.kind = kind;
  const label = pill.querySelector('.pill-text');
  if (label) label.textContent = text;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* Status pills */
async function loadStatus() {
  const retry = $<HTMLButtonElement>('retry-status');
  retry.hidden = true;
  setPill('pill-api', 'wait', 'Papertrade API: checking');
  setPill('pill-pay', 'wait', 'Payments: checking');
  try {
    const { body } = await getJson<Health>('/api/v1/health');
    if (body.upstream.ok) setPill('pill-api', 'ok', `Papertrade API live, block ${body.upstream.indexedThroughBlock?.toLocaleString('en-US') ?? '?'}`);
    else setPill('pill-api', 'bad', 'Papertrade API unreachable');
    const configured = body.x402.configured;
    setPill('pill-pay', configured ? 'ok' : 'warn', configured ? 'Payments: accepting' : 'Payments: not configured');
    for (const n of body.x402.networks) {
      setPill(n.label === 'solana' ? 'pill-sol' : 'pill-base', n.configured ? 'ok' : 'warn', `${n.label === 'solana' ? 'Solana' : 'Base'} USDC${n.configured ? '' : ': not configured'}`);
    }
    if (!body.upstream.ok) retry.hidden = false;
  } catch (e) {
    setPill('pill-api', 'bad', 'Status unavailable');
    setPill('pill-pay', 'bad', errMsg(e));
    retry.hidden = false;
  }
}

/* Markets */
async function loadMarkets() {
  const box = $('markets');
  const err = $('markets-error');
  err.hidden = true;
  box.setAttribute('aria-busy', 'true');
  box.replaceChildren(...[0, 1].map(() => el('div', { class: 'card' }, [el('span', { class: 'skeleton wide' }), el('span', { class: 'skeleton' })])));
  try {
    const { status, body } = await getJson<{ markets: Market[]; message?: string }>('/api/v1/markets');
    if (status !== 200) throw new Error(body.message ?? `HTTP ${status}`);
    if (body.markets.length === 0) {
      box.replaceChildren(el('p', { class: 'muted', text: 'No Papertrade markets are open right now. Check back soon.' }));
    } else {
      box.replaceChildren(
        ...body.markets.map((m) => {
          const total = m.longOpenInterestUsd + m.shortOpenInterestUsd;
          const longPct = total > 0 ? (m.longOpenInterestUsd / total) * 100 : 50;
          const bar = el('div', { class: 'oi', attrs: { role: 'img', 'aria-label': `Long ${longPct.toFixed(0)} percent, short ${(100 - longPct).toFixed(0)} percent of open interest` } }, [el('i', { class: 'l' }), el('i', { class: 's' })]);
          (bar.children[0] as HTMLElement).style.width = `${longPct}%`;
          (bar.children[1] as HTMLElement).style.width = `${100 - longPct}%`;
          return el('article', { class: 'card' }, [
            el('div', { class: 'sym', text: `${m.symbol}-PERP` }),
            el('div', { class: 'px', text: usd(m.markPrice, m.markPrice < 100 ? 4 : 2) }),
            el('div', { class: 'meta' }, [
              el('span', { text: `max ${m.maxLeverage}x` }),
              el('span', { text: `OI long ${compact(m.longOpenInterestUsd)}` }),
              el('span', { text: `short ${compact(m.shortOpenInterestUsd)}` }),
              el('span', { text: m.openable ? 'open' : 'closed to new positions' }),
            ]),
            bar,
          ]);
        }),
      );
    }
  } catch (e) {
    box.replaceChildren();
    $('markets-error-text').textContent = `Could not load live markets: ${errMsg(e)}`;
    err.hidden = false;
  } finally {
    box.setAttribute('aria-busy', 'false');
  }
}

/* Catalog */
async function loadCatalog() {
  const list = $('catalog-list');
  const err = $('catalog-error');
  err.hidden = true;
  list.setAttribute('aria-busy', 'true');
  try {
    const { body } = await getJson<Discovery>('/.well-known/x402');
    $('not-configured').hidden = body.configured;
    list.replaceChildren(
      ...body.endpoints.map((e) => {
        const path = decodeURIComponent(new URL(e.resource, location.origin).pathname);
        const nets = body.networks.map((n) => {
          const on = e.accepts.some((a) => a.network === n.network);
          return el('span', { class: `net ${n.label}${on ? '' : ' off'}`, text: on ? `${n.label} USDC` : `${n.label}: not configured` });
        });
        return el('article', { class: 'card ep' }, [
          el('div', { class: 'row' }, [
            el('h3', { text: e.description.split('.')[0].slice(0, 48) === '' ? e.id : titleFor(e.id) }),
            el('div', { class: 'price', text: `$${e.price.amount}` }, [el('small', { text: 'USDC/call' })]),
          ]),
          el('div', { class: 'route' }, [el('b', { text: e.method }), ` ${path}`]),
          el('p', { text: e.description }),
          el('div', { class: 'nets' }, nets),
        ]);
      }),
    );
  } catch (e) {
    list.replaceChildren();
    $('catalog-error-text').textContent = `Could not load the endpoint catalog: ${errMsg(e)}`;
    err.hidden = false;
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

function titleFor(id: string): string {
  switch (id) {
    case 'wallet-risk':
      return 'Wallet liquidation risk';
    case 'liquidations-nearby':
      return 'Nearby liquidations map';
    case 'estimate':
      return 'Close and bust estimate';
    case 'traders-top':
      return 'Top traders';
    default:
      return id;
  }
}

/* Try the 402 */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function syncFields() {
  const id = $<HTMLSelectElement>('try-endpoint').value;
  document.querySelectorAll<HTMLElement>('#try-form .field[data-for]').forEach((f) => {
    f.hidden = !(f.dataset.for ?? '').split(' ').includes(id);
  });
}

interface Built {
  url: string;
  init: RequestInit;
  line: string;
  preview: boolean;
  endpoint: string;
}

function buildRequest(form: HTMLFormElement): Built | { error: string; field: string } {
  const data = new FormData(form);
  const v = (k: string) => String(data.get(k) ?? '').trim();
  const preview = v('mode') === 'preview';
  const base = preview ? '/api/v1/preview' : '/api/v1';
  const endpoint = v('endpoint');
  switch (endpoint) {
    case 'wallet-risk': {
      if (!ADDRESS_RE.test(v('address'))) return { error: 'Enter a 0x address with 40 hex characters.', field: 'try-address' };
      const url = `${base}/wallet/${v('address')}/risk`;
      return { url, init: {}, line: `GET ${url}`, preview, endpoint };
    }
    case 'liquidations-nearby': {
      const pct = Number(v('pct'));
      if (!(pct > 0 && pct <= 25)) return { error: 'Window must be above 0 and at most 25.', field: 'try-pct' };
      const url = `${base}/liquidations/nearby?market=${encodeURIComponent(v('market'))}&pct=${pct}`;
      return { url, init: {}, line: `GET ${url}`, preview, endpoint };
    }
    case 'estimate': {
      const marginUsd = Number(v('marginUsd'));
      const leverage = Number(v('leverage'));
      if (!(marginUsd > 0)) return { error: 'Margin must be a positive number.', field: 'try-margin' };
      if (!Number.isInteger(leverage) || leverage < 1 || leverage > 1000) return { error: 'Leverage must be a whole number from 1 to 1000.', field: 'try-leverage' };
      const body = { market: v('market'), side: v('side'), marginUsd, leverage };
      return { url: `${base}/estimate`, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, line: `POST ${base}/estimate`, preview, endpoint };
    }
    default: {
      const url = `${base}/traders/top?window=${encodeURIComponent(v('window'))}`;
      return { url, init: {}, line: `GET ${url}`, preview, endpoint };
    }
  }
}

function decodeHeader(header: string): { accepts?: Accept[]; error?: string } {
  const bytes = Uint8Array.from(atob(header), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const atomicToUsdc = (a: string) => (Number(a) / 1_000_000).toString();
const shorten = (s: string) => (s.length > 20 ? `${s.slice(0, 8)}...${s.slice(-6)}` : s);

async function sendUnpaid(form: HTMLFormElement) {
  const send = $<HTMLButtonElement>('try-send');
  const result = $('try-result');
  const retry = $<HTMLButtonElement>('try-retry');
  document.querySelectorAll('#try-form [aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  document.querySelectorAll('#try-form .hint.err').forEach((n) => n.remove());
  const req = buildRequest(form);
  if ('error' in req) {
    const input = $(req.field);
    input.setAttribute('aria-invalid', 'true');
    input.parentElement?.append(el('span', { class: 'hint err', text: req.error, attrs: { role: 'alert' } }));
    input.focus();
    return;
  }
  send.disabled = true;
  send.textContent = 'Sending...';
  retry.hidden = true;
  $('try-preview').hidden = true;
  result.hidden = false;
  const chip = $('try-status');
  chip.className = 'status-chip';
  chip.textContent = '...';
  $('try-line').textContent = req.line;
  $('try-note').textContent = 'Waiting for the server.';
  $('try-accepts').replaceChildren();
  $('try-json').textContent = '';
  try {
    const res = await fetch(req.url, req.init);
    const header = res.headers.get('PAYMENT-REQUIRED');
    chip.textContent = `${res.status} ${res.statusText || ''}`.trim();
    $<HTMLDetailsElement>('try-details').open = false;
    if (req.preview) {
      chip.classList.add(res.ok ? 'ok' : 'bad');
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* non-JSON body is shown as-is */
      }
      $('try-summary').textContent = 'Response body';
      const details = $<HTMLDetailsElement>('try-details');
      details.open = true;
      $('try-json').textContent = pretty;
      if (res.ok) $('try-note').textContent = 'Free preview: the same live computation as the paid route, with the paid detail withheld (see the preview.omitted field). Nothing was charged.';
      else if (res.status === 429) $('try-note').textContent = `Preview rate limit reached. Try again in ${res.headers.get('Retry-After') ?? 'a few'} seconds.`;
      else $('try-note').textContent = 'The preview request was rejected. Check the response body for the reason.';
      if (!res.ok) retry.hidden = false;
    } else if (res.status === 402 && header) {
      $('try-summary').textContent = 'Decoded PAYMENT-REQUIRED header';
      const decoded = decodeHeader(header);
      $('try-note').textContent = 'Payment required, as expected. A paying client would sign one of these options and retry with a PAYMENT-SIGNATURE header. You were not charged.';
      $('try-accepts').replaceChildren(
        ...(decoded.accepts ?? []).map((a) =>
          el('dl', { class: 'accept' }, [
            el('dt', { text: 'network' }),
            el('dd', { text: a.network.startsWith('solana') ? `Solana mainnet (${a.network})` : `Base (${a.network})` }),
            el('dt', { text: 'price' }),
            el('dd', { text: `${atomicToUsdc(a.amount)} USDC` }),
            el('dt', { text: 'pay to' }),
            el('dd', { text: shorten(a.payTo), attrs: { title: a.payTo } }),
            el('dt', { text: 'asset' }),
            el('dd', { text: shorten(a.asset), attrs: { title: a.asset } }),
          ]),
        ),
      );
      $('try-json').textContent = JSON.stringify(decoded, null, 2);
    } else {
      chip.classList.add(res.status >= 500 ? 'bad' : 'ok');
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* non-JSON body is shown as-is */
      }
      const note = res.status === 503 ? 'Payments are not switched on yet: the operator has not set a payout address, so there is no 402 challenge to show. This is the real, explanatory response. The free preview returns live data now.' : res.status === 400 ? 'The request was rejected before any payment was asked for.' : 'The server answered without a payment challenge.';
      $('try-note').textContent = note;
      $('try-summary').textContent = 'Response body';
      $<HTMLDetailsElement>('try-details').open = true;
      $('try-json').textContent = pretty;
      if (res.status === 503) $('try-preview').hidden = false;
      chip.classList.toggle('ok', res.status < 400);
    }
  } catch (e) {
    chip.textContent = 'Failed';
    chip.classList.add('bad');
    $('try-note').textContent = `The request did not complete: ${errMsg(e)}`;
    retry.hidden = false;
  } finally {
    send.disabled = false;
    send.textContent = $<HTMLSelectElement>('try-mode').value === 'preview' ? 'Send free preview request' : 'Send unpaid request';
  }
}

function syncMode() {
  $('try-send').textContent = $<HTMLSelectElement>('try-mode').value === 'preview' ? 'Send free preview request' : 'Send unpaid request';
}

/* Copy buttons */
function wireCopy() {
  document.querySelectorAll<HTMLButtonElement>('button.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = document.getElementById(btn.dataset.copy ?? '');
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent ?? '');
        btn.textContent = 'Copied';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        btn.textContent = 'Select + copy';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1600);
    });
  });
}

function init() {
  $('retry-status').addEventListener('click', () => void loadStatus());
  $('markets-retry').addEventListener('click', () => void loadMarkets());
  $('catalog-retry').addEventListener('click', () => void loadCatalog());
  const form = $<HTMLFormElement>('try-form');
  $('try-endpoint').addEventListener('change', syncFields);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void sendUnpaid(form);
  });
  $('try-retry').addEventListener('click', () => void sendUnpaid(form));
  $('try-preview').addEventListener('click', () => {
    $<HTMLSelectElement>('try-mode').value = 'preview';
    syncMode();
    void sendUnpaid(form);
  });
  $('try-mode').addEventListener('change', syncMode);
  syncFields();
  wireCopy();
  void loadStatus();
  void loadMarkets();
  void loadCatalog();
}

init();

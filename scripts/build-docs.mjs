#!/usr/bin/env node
/**
 * Builds the documentation site from docs/*.md.
 *
 * Output under site/public: docs/<slug>/index.html, docs/<slug>.md (raw twin), docs/search-index.json,
 * docs/docs.css, docs/docs.js, plus llms.txt, llms-full.txt (also copied to the repo root llms.txt)
 * and sitemap.xml. CSS and JS are external files because the site CSP forbids inline code.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://papertrade-x402.pages.dev';
const DOCS_SRC = join(root, 'docs');
const PUBLIC = join(root, 'site', 'public');
const OUT = join(PUBLIC, 'docs');

/** Page order. Anything in docs/ that is not listed is appended alphabetically. */
const ORDER = ['overview', 'quickstart', 'concepts', 'api-reference', 'mcp', 'connect-your-ai', 'agent-discovery', 'paying-as-an-agent', 'self-hosting', 'security-and-limits', 'faq', 'changelog'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function parseFront(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('docs page is missing front matter');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

/** CHANGELOG.md becomes the Changelog page so the docs never drift from the repository. */
function changelogPage() {
  const raw = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/^# Changelog\n+/, '');
  return `---\ntitle: Changelog\ndescription: Release history of papertrade-x402.\n---\n\n# Changelog\n\n${raw.replace(/^## /gm, '## ')}`;
}

function load() {
  const files = readdirSync(DOCS_SRC).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  const slugs = [...new Set([...ORDER, ...files.sort()])].filter((s) => s === 'changelog' || files.includes(s));
  return slugs.map((slug) => {
    const raw = slug === 'changelog' && !files.includes('changelog') ? changelogPage() : readFileSync(join(DOCS_SRC, `${slug}.md`), 'utf8');
    const { meta, body } = parseFront(raw);
    return { slug, title: meta.title, description: meta.description, body };
  });
}

function render(page) {
  const toc = [];
  const used = new Set();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(text);
        while (used.has(id)) id += '-2';
        used.add(id);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: text.replace(/`/g, '') });
        return `<h${depth} id="${id}">${inner}${depth > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ''}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const l = (lang || '').split(/\s/)[0];
        return `<div class="code"><pre><code${l ? ` class="language-${esc(l)}"` : ''}>${esc(text)}</code></pre></div>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.startsWith(SITE);
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${inner}</a>`;
      },
    },
  });
  let html = marked.parse(page.body);
  html = html.replace(/<table>/g, '<div class="tw"><table>').replace(/<\/table>/g, '</table></div>');
  return { html, toc };
}

const plain = (md) => md.replace(/```[a-z]*\n?/g, '').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[#>\s|*-]+/gm, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

function layout(page, pages, { html, toc }) {
  const i = pages.findIndex((p) => p.slug === page.slug);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  const url = `${SITE}/docs/${page.slug}/`;
  const nav = pages.map((p) => `<li><a href="/docs/${p.slug}/"${p.slug === page.slug ? ' aria-current="page"' : ''}>${esc(p.title)}</a></li>`).join('');
  const tocHtml = toc.length ? `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${toc.map((t) => `<li class="d${t.depth}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></nav>` : '';
  const pn = `<nav class="pn" aria-label="Pager">${prev ? `<a class="prev" href="/docs/${prev.slug}/"><span>Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="/docs/${next.slug}/"><span>Next</span>${esc(next.title)}</a>` : '<span></span>'}</nav>`;
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'TechArticle', headline: page.title, description: page.description, url, inLanguage: 'en', license: 'https://www.apache.org/licenses/LICENSE-2.0', author: { '@type': 'Person', name: 'nirholas' } });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} | papertrade-x402 docs</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" type="text/markdown" href="/docs/${page.slug}.md">
<meta property="og:title" content="${esc(page.title)} | papertrade-x402 docs">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="article">
<meta name="color-scheme" content="dark light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23ffb000'/%3E%3Cpath d='M8 11h16M8 16h16M8 21h9' stroke='%231a1206' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/docs/docs.css">
<script type="application/ld+json">${ld}</script>
<script src="/docs/docs.js" defer></script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="bar">
  <button class="menu" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="side">Menu</button>
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>papertrade-x402</a>
  <span class="tag">docs</span>
  <form class="search" role="search" id="search-form"><label class="vh" for="q">Search the docs</label><input id="q" type="search" placeholder="Search docs" autocomplete="off" spellcheck="false"><ul id="results" hidden></ul></form>
  <a class="plain" href="/docs/${page.slug}.md">Markdown</a>
  <a class="plain" href="https://github.com/nirholas/papertrade-x402">GitHub</a>
  <button class="theme" type="button" aria-label="Toggle color theme">Theme</button>
</header>
<div class="shell">
  <aside class="side" id="side"><nav aria-label="Documentation"><ul>${nav}</ul></nav>
    <p class="side-links"><a href="/mcp">MCP endpoint</a> <a href="/openapi.json">OpenAPI</a> <a href="/llms.txt">llms.txt</a> <a href="/.well-known/x402">x402 discovery</a></p>
  </aside>
  <main id="content" tabindex="-1"><article class="doc">${html}</article>${pn}
    <footer class="foot"><p><strong>Unofficial, not affiliated with Papertrade.</strong> High leverage can lose your whole margin. Apache-2.0. <a href="https://github.com/nirholas/papertrade-x402/edit/main/docs/${page.slug}.md">Edit this page</a></p></footer>
  </main>
  ${tocHtml}
</div>
</body>
</html>
`;
}

const CSS = `:root{color-scheme:light dark;--bg:#f7f2e8;--surface:#fffdf8;--surface-2:#efe8d9;--ink:#1d1708;--muted:#6a5f47;--line:#d9ceb4;--accent:#b45f00;--accent-ink:#fff;--accent-soft:#fbe9c8;--focus:#1750d6;--mono:ui-monospace,'SF Mono','JetBrains Mono',Menlo,Consolas,monospace;--sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f0c07;--surface:#17120a;--surface-2:#211a0e;--ink:#f4ecda;--muted:#a99d82;--line:#34290f;--accent:#ffb000;--accent-ink:#1a1206;--accent-soft:#2c2008;--focus:#8db2ff}}
:root[data-theme=dark]{color-scheme:dark;--bg:#0f0c07;--surface:#17120a;--surface-2:#211a0e;--ink:#f4ecda;--muted:#a99d82;--line:#34290f;--accent:#ffb000;--accent-ink:#1a1206;--accent-soft:#2c2008;--focus:#8db2ff}
:root[data-theme=light]{color-scheme:light}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 var(--sans);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}
a{color:var(--accent);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}
code,pre{font-family:var(--mono);font-size:.9em}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:12px;top:-48px;background:var(--accent);color:var(--accent-ink);padding:8px 14px;border-radius:8px;z-index:30;transition:top .15s}.skip:focus{top:12px}
.bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;padding:10px 20px;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--ink);text-decoration:none;white-space:nowrap}
.mark{width:18px;height:18px;border-radius:5px;background:var(--accent);display:inline-block}
.tag{font:600 12px var(--mono);color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.plain{color:var(--muted);text-decoration:none;font-size:14px;white-space:nowrap}.plain:hover{color:var(--ink)}
.bar button{font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer}
.bar button:hover{border-color:var(--accent)}.bar button:active{transform:translateY(1px)}
.menu{display:none}
.search{position:relative;margin-left:auto;flex:0 1 320px}
.search input{width:100%;font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:7px 12px}
.search input:hover{border-color:var(--muted)}
#results{position:absolute;top:calc(100% + 6px);left:0;right:0;margin:0;padding:6px;list-style:none;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px -12px rgba(0,0,0,.45);max-height:70vh;overflow:auto}
#results a{display:block;padding:8px 10px;border-radius:7px;color:var(--ink);text-decoration:none}
#results a:hover,#results a:focus-visible,#results a[aria-selected=true]{background:var(--accent-soft)}
#results b{display:block;font-size:14px}#results span{display:block;font-size:13px;color:var(--muted)}
#results .none{padding:10px;color:var(--muted);font-size:14px}
.shell{display:grid;grid-template-columns:240px minmax(0,1fr) 220px;gap:36px;max-width:1280px;margin:0 auto;padding:0 20px}
.side{position:sticky;top:60px;align-self:start;max-height:calc(100vh - 70px);overflow:auto;padding:24px 0}
.side ul{list-style:none;margin:0;padding:0}.side li a{display:block;padding:6px 12px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:15px}
.side li a:hover{background:var(--surface-2);color:var(--ink)}.side li a[aria-current=page]{background:var(--accent-soft);color:var(--ink);font-weight:600}
.side-links{display:flex;flex-direction:column;gap:2px;margin:18px 0 0;padding:14px 12px 0;border-top:1px solid var(--line);font-size:14px}
main{padding:32px 0 60px;min-width:0;outline:none}
.doc h1{font-size:clamp(28px,4vw,38px);line-height:1.15;margin:0 0 18px;letter-spacing:-.02em}
.doc h2{font-size:24px;margin:2.2em 0 .6em;padding-top:.3em;letter-spacing:-.01em;border-top:1px solid var(--line)}
.doc h3{font-size:18px;margin:1.8em 0 .5em}
.doc h2 .anchor,.doc h3 .anchor{margin-left:8px;text-decoration:none;opacity:0;font-weight:400}
.doc h2:hover .anchor,.doc h3:hover .anchor,.anchor:focus-visible{opacity:1}
.doc p,.doc li{max-width:74ch}
.doc code{background:var(--surface-2);border-radius:5px;padding:.12em .38em}
.code{position:relative;margin:1.1em 0}
.code pre{margin:0;padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:auto;line-height:1.5}
.code pre code{background:none;padding:0;border-radius:0;font-size:13.5px}
.copy{position:absolute;top:8px;right:8px;font:600 12px var(--sans);color:var(--muted);background:var(--surface-2);border:1px solid var(--line);border-radius:7px;padding:4px 10px;cursor:pointer;opacity:0;transition:opacity .15s}
.code:hover .copy,.copy:focus-visible,.copy[data-done]{opacity:1}.copy:hover{color:var(--ink);border-color:var(--accent)}.copy:active{transform:translateY(1px)}
@media(hover:none){.copy{opacity:1}}
.tw{overflow-x:auto;margin:1.1em 0;border:1px solid var(--line);border-radius:10px}
.doc table{border-collapse:collapse;width:100%;font-size:14.5px}
.doc th,.doc td{text-align:left;padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.doc th{background:var(--surface-2);font-weight:600;white-space:nowrap}.doc tr:last-child td{border-bottom:0}
.doc blockquote{margin:1.2em 0;padding:12px 18px;border-left:4px solid var(--accent);background:var(--accent-soft);border-radius:0 10px 10px 0}.doc blockquote p{margin:.3em 0}
.toc{position:sticky;top:60px;align-self:start;max-height:calc(100vh - 70px);overflow:auto;padding:32px 0;font-size:14px}
.toc p{margin:0 0 8px;font-weight:600;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.06em}
.toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--line)}.toc a{display:block;padding:4px 12px;color:var(--muted);text-decoration:none}
.toc a:hover{color:var(--ink)}.toc a[aria-current=true]{color:var(--accent);font-weight:600}.toc .d3 a{padding-left:24px}
.pn{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:48px}
.pn a{display:block;padding:14px 18px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);text-decoration:none;font-weight:600}
.pn a:hover{border-color:var(--accent)}.pn a span{display:block;font-size:12px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.pn .next{text-align:right}
.foot{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
@media(max-width:1100px){.shell{grid-template-columns:220px minmax(0,1fr)}.toc{display:none}}
@media(max-width:780px){.menu{display:inline-block}.plain,.tag{display:none}.bar{gap:10px;padding:10px 14px}.search{flex:1 1 auto}
.shell{grid-template-columns:minmax(0,1fr);gap:0;padding:0 16px}
.side{display:none;position:fixed;inset:57px 0 0 0;max-height:none;z-index:15;background:var(--bg);padding:16px 20px;border-top:1px solid var(--line)}
.side[data-open]{display:block}.pn{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
`;

const JS = `(()=>{
const root=document.documentElement;
try{const t=localStorage.getItem('docs-theme');if(t)root.dataset.theme=t}catch{}
document.querySelector('.theme')?.addEventListener('click',()=>{
  const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
  const next=dark?'light':'dark';root.dataset.theme=next;try{localStorage.setItem('docs-theme',next)}catch{}
});
const menu=document.querySelector('.menu'),side=document.getElementById('side');
menu?.addEventListener('click',()=>{const o=side.toggleAttribute('data-open');menu.setAttribute('aria-expanded',String(o));menu.textContent=o?'Close':'Menu'});
document.querySelectorAll('.code').forEach(b=>{
  const btn=document.createElement('button');btn.type='button';btn.className='copy';btn.textContent='Copy';btn.setAttribute('aria-label','Copy code');
  btn.addEventListener('click',async()=>{
    const text=b.querySelector('code').textContent;
    try{await navigator.clipboard.writeText(text);btn.textContent='Copied';btn.dataset.done='1'}
    catch{const r=document.createRange();r.selectNodeContents(b.querySelector('code'));const s=getSelection();s.removeAllRanges();s.addRange(r);btn.textContent='Press Ctrl+C'}
    setTimeout(()=>{btn.textContent='Copy';delete btn.dataset.done},1800);
  });
  b.appendChild(btn);
});
const links=[...document.querySelectorAll('.toc a')];
if(links.length&&'IntersectionObserver' in window){
  const map=new Map(links.map(a=>[a.getAttribute('href').slice(1),a]));
  const io=new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting){links.forEach(l=>l.removeAttribute('aria-current'));map.get(e.target.id)?.setAttribute('aria-current','true')}}},{rootMargin:'-70px 0px -70% 0px'});
  map.forEach((_,id)=>{const h=document.getElementById(id);if(h)io.observe(h)});
}
const input=document.getElementById('q'),list=document.getElementById('results');
let index=null,loading=null,sel=-1;
const load=()=>loading||(loading=fetch('/docs/search-index.json').then(r=>{if(!r.ok)throw new Error(String(r.status));return r.json()}).then(j=>(index=j)));
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function run(q){
  const terms=q.toLowerCase().split(/\\s+/).filter(Boolean);
  if(!terms.length){list.hidden=true;return}
  const hits=index.map(d=>{let s=0;for(const t of terms){const ti=d.title.toLowerCase().includes(t),hd=d.headings.toLowerCase().includes(t),tx=d.text.toLowerCase().includes(t);if(!ti&&!hd&&!tx)return null;s+=(ti?10:0)+(hd?4:0)+(tx?1:0)}return{d,s}}).filter(Boolean).sort((a,b)=>b.s-a.s).slice(0,8);
  list.innerHTML=hits.length?hits.map(({d})=>{const i=d.text.toLowerCase().indexOf(terms[0]);const sn=i<0?d.description:(i>40?'...':'')+d.text.slice(Math.max(0,i-40),i+110)+'...';return '<li><a href="'+d.url+'"><b>'+esc(d.title)+'</b><span>'+esc(sn)+'</span></a></li>'}).join(''):'<li class="none">No results. Try a shorter term such as "mcp" or "402".</li>';
  list.hidden=false;sel=-1;
}
input?.addEventListener('focus',()=>load().catch(()=>{}));
input?.addEventListener('input',async()=>{try{await load();run(input.value)}catch{list.innerHTML='<li class="none">Search is unavailable. Reload the page to retry.</li>';list.hidden=false}});
input?.addEventListener('keydown',e=>{
  const items=[...list.querySelectorAll('a')];
  if(e.key==='Escape'){list.hidden=true;input.blur()}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(!items.length)return;e.preventDefault();sel=(sel+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items.forEach((a,i)=>a.setAttribute('aria-selected',String(i===sel)));items[sel].scrollIntoView({block:'nearest'})}
  else if(e.key==='Enter'&&sel>=0){e.preventDefault();items[sel].click()}
});
document.addEventListener('click',e=>{if(!e.target.closest('.search'))list.hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea/i.test(document.activeElement.tagName)){e.preventDefault();input?.focus()}});
})();
`;

function llmsIndex(pages) {
  return `# papertrade-x402

> Unofficial pay-per-call intelligence API over Papertrade (https://papertrade.xyz), the on-chain 1000x synthetic perps exchange on Hyperliquid HyperEVM. Agents pay per request in USDC with the x402 protocol, on Solana first or Base second. No API keys, no accounts. Free preview tier and a read-only MCP server. Not affiliated with Papertrade. High leverage can lose your whole margin.

Base URL: ${SITE}

## Machine-readable descriptions

- [MCP server (Streamable HTTP)](${SITE}/mcp): ten read-only tools. Free tools return data, paid tools return x402 payment requirements and never pay.
- [OpenAPI 3.1](${SITE}/openapi.json): every route, parameters, response shapes and \`x-payment-info\`.
- [x402 discovery](${SITE}/.well-known/x402): resources, prices, accepted networks, payTo, input and output schemas, status.
- [MCP server card](${SITE}/.well-known/mcp/server-card.json)
- [A2A agent card](${SITE}/.well-known/agent-card.json)
- [API catalog (RFC 9727)](${SITE}/.well-known/api-catalog)
- [Full documentation in one file](${SITE}/llms-full.txt)

## Docs

${pages.map((p) => `- [${p.title}](${SITE}/docs/${p.slug}.md): ${p.description}`).join('\n')}

## Free endpoints

- GET /api/v1/health: upstream status and payment configuration.
- GET /api/v1/markets: live Papertrade markets, mark prices and open interest.
- GET /api/v1/preview/wallet/{address}/risk, GET /api/v1/preview/liquidations/nearby, POST /api/v1/preview/estimate, GET /api/v1/preview/traders/top: rate limited free previews of each paid route.

## Paid endpoints (USDC per call, prices set by the operator)

- GET /api/v1/wallet/{address}/risk: liquidation risk for every open position of a HyperEVM wallet (default $0.02).
- GET /api/v1/liquidations/nearby?market=BTC&pct=0.5: liquidation map within a percent window of mark (default $0.05).
- POST /api/v1/estimate: close and bust estimate for a hypothetical position (default $0.005).
- GET /api/v1/traders/top?window=7d: leaderboard of top traders with derived stats (default $0.03).

## How to pay

1. Call a paid route with no payment. The server answers HTTP 402 with a base64 \`PAYMENT-REQUIRED\` header listing \`accepts\` (Solana USDC first, Base USDC second).
2. Sign one option with an x402 client using your own wallet.
3. Retry with a \`PAYMENT-SIGNATURE\` header. Settlement happens only after a successful 2xx. Invalid input (400), unconfigured service (503) and upstream failures (502) are never charged.

If the operator has not set a payout address yet, paid routes answer 503 with an explanation and \`status\` in the discovery document is \`payments_not_configured\`. Use the free tier until it changes.

## Source

- https://github.com/nirholas/papertrade-x402 (Apache-2.0)
`;
}

function main() {
  const pages = load();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const index = [];
  const full = [];
  for (const page of pages) {
    const rendered = render(page);
    mkdirSync(join(OUT, page.slug), { recursive: true });
    writeFileSync(join(OUT, page.slug, 'index.html'), layout(page, pages, rendered));
    const md = `# ${page.title}\n\nSource: ${SITE}/docs/${page.slug}/\n\n${page.body.replace(/^# .*\n+/, '')}`;
    writeFileSync(join(OUT, `${page.slug}.md`), md);
    full.push(`\n\n---\n\n${md}`);
    index.push({ title: page.title, description: page.description, url: `/docs/${page.slug}/`, headings: rendered.toc.map((t) => t.text).join(' | '), text: plain(page.body) });
  }
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>papertrade-x402 docs</title><link rel="canonical" href="${SITE}/docs/overview/"><meta http-equiv="refresh" content="0; url=/docs/overview/"></head><body><p><a href="/docs/overview/">Open the documentation</a></p></body></html>\n`);
  writeFileSync(join(OUT, 'search-index.json'), JSON.stringify(index));
  writeFileSync(join(OUT, 'docs.css'), CSS);
  writeFileSync(join(OUT, 'docs.js'), JS);
  const idx = llmsIndex(pages);
  writeFileSync(join(PUBLIC, 'llms.txt'), idx);
  writeFileSync(join(root, 'llms.txt'), idx);
  writeFileSync(join(PUBLIC, 'llms-full.txt'), `${idx}\n\n# Full documentation${full.join('')}\n`);
  const today = new Date().toISOString().slice(0, 10);
  const urls = ['/', ...pages.map((p) => `/docs/${p.slug}/`), '/openapi.json', '/.well-known/x402', '/.well-known/mcp/server-card.json', '/.well-known/agent-card.json', '/.well-known/api-catalog', '/llms.txt', '/llms-full.txt'];
  writeFileSync(join(PUBLIC, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  console.log(`docs: ${pages.length} pages, ${index.length} indexed`);
}

main();

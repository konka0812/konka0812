#!/usr/bin/env node
/**
 * Regenerate assets/stats.svg from live GitHub data.
 *
 * The profile used to rely on github-readme-stats.vercel.app, but that public
 * deployment now answers 503 DEPLOYMENT_PAUSED, so the card is generated here
 * instead and committed as a static SVG (no third-party runtime dependency,
 * renders even if every external service is down).
 *
 * Run locally:   GITHUB_TOKEN=... node scripts/update-stats.mjs
 * Run in CI:     .github/workflows/update-stats.yml (weekly + manual)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const LOGIN = 'konka0812';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const API = 'https://api.github.com';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'stats.svg');

const SANS = 'Segoe UI, -apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif';
const MONO = 'SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace';
const CJK = 'PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, sans-serif';

const BLUEPRINT_PALETTE = ['#38BDF8', '#BAE6FD', '#0284C7', '#7DD3FC', '#0EA5E9', '#0369A1', '#155E75', '#FBBF24'];

async function gh(path, { graphql = false, body } = {}) {
  const url = graphql ? `${API}/graphql` : path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, {
    method: graphql ? 'POST' : 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'konka0812-profile-stats',
      'x-github-api-version': '2022-11-28',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(graphql ? { 'content-type': 'application/json' } : {}),
    },
    body: graphql ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function collect() {
  const user = await gh(`/users/${LOGIN}`);

  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const chunk = await gh(`/users/${LOGIN}/repos?per_page=100&type=owner&page=${page}`);
    repos.push(...chunk);
    if (chunk.length < 100) break;
  }

  const pubs = repos.filter((r) => !r.private);
  const stars = pubs.reduce((n, r) => n + r.stargazers_count, 0);

  // language bytes across public repos only (matches what a visitor can verify)
  const bytes = {};
  for (const r of pubs) {
    try {
      const langs = await gh(`/repos/${LOGIN}/${r.name}/languages`);
      for (const [k, v] of Object.entries(langs)) bytes[k] = (bytes[k] || 0) + v;
    } catch {
      /* a single failing repo must not kill the whole card */
    }
  }
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(bytes)
    .map(([name, v]) => ({ name, pct: +((v / total) * 100).toFixed(1) }))
    .sort((a, b) => b.pct - a.pct);

  // contributions + active repos via GraphQL; degrade gracefully if unavailable
  let contributions = 0;
  let activeRepos = 0;
  try {
    const g = await gh('', {
      graphql: true,
      body: {
        query: `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions} totalRepositoriesWithContributedCommits}}}`,
        variables: { login: LOGIN },
      },
    });
    const cc = g?.data?.user?.contributionsCollection;
    contributions = cc?.contributionCalendar?.totalContributions ?? 0;
    activeRepos = cc?.totalRepositoriesWithContributedCommits ?? 0;
  } catch {
    const cutoff = Date.now() - 365 * 24 * 3600 * 1000;
    activeRepos = repos.filter((r) => new Date(r.pushed_at).getTime() > cutoff).length;
  }

  return {
    since: (user.created_at || '').slice(0, 7).replace('-', '.'),
    kpis: [
      { value: String(pubs.length), label: '公开仓库', en: 'PUBLIC REPOS' },
      { value: String(stars), label: '累计 Star', en: 'STARS EARNED' },
      { value: String(contributions), label: '年度贡献', en: 'CONTRIBUTIONS' },
      { value: String(activeRepos), label: '活跃仓库', en: 'ACTIVE REPOS' },
    ],
    langs,
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build({ since, kpis, langs }) {
  const W = 1000, H = 284, pad = 44;
  const barW = W - pad * 2;
  const colors = langs.map((_, i) => BLUEPRINT_PALETTE[i % BLUEPRINT_PALETTE.length]);

  const grid = [];
  for (let x = 0; x <= W; x += 20) if (x % 100) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
  for (let y = 0; y <= H; y += 20) if (y % 100) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);
  const major = [];
  for (let x = 0; x <= W; x += 100) major.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
  for (let y = 0; y <= H; y += 100) major.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);

  let segX = pad;
  const segs = langs.map((l, i) => {
    const w = (l.pct / 100) * barW;
    const s = `<rect x="${segX.toFixed(2)}" y="232" width="${(w + 0.6).toFixed(2)}" height="11" fill="${colors[i]}"/>`;
    segX += w;
    return s;
  });

  const shown = langs.slice(0, 6);
  const lw = barW / Math.max(shown.length, 1);
  const legend = shown.map((l, i) => {
    const lx = pad + lw * i;
    return `<circle cx="${(lx + 5).toFixed(1)}" cy="258" r="4" fill="${colors[i]}"/>` +
      `<text x="${(lx + 16).toFixed(1)}" y="262" font-family="${MONO}" font-size="11" fill="#CBD5E1">${esc(l.name)}</text>` +
      `<text x="${(lx + 16 + l.name.length * 6.6 + 6).toFixed(1)}" y="262" font-family="${MONO}" font-size="11" fill="#5B7A94">${l.pct}%</text>`;
  }).join('');

  const cols = kpis.map((k, i) => {
    const cx = pad + ((W - pad * 2) / kpis.length) * i + (W - pad * 2) / kpis.length / 2;
    return `<text x="${cx.toFixed(1)}" y="128" text-anchor="middle" font-family="${MONO}" font-size="44" font-weight="700" fill="#38BDF8">${esc(k.value)}</text>` +
      `<text x="${cx.toFixed(1)}" y="158" text-anchor="middle" font-family="${CJK}" font-size="13" fill="#CBD5E1">${esc(k.label)}</text>` +
      `<text x="${cx.toFixed(1)}" y="176" text-anchor="middle" font-family="${MONO}" font-size="9" letter-spacing="1.6" fill="#5B7A94">${esc(k.en)}</text>`;
  }).join('');

  const ticks = Array.from({ length: 11 }, (_, i) => {
    const x = pad + (barW / 10) * i;
    return `<line x1="${x.toFixed(1)}" y1="197" x2="${x.toFixed(1)}" y2="202" stroke="#38BDF8" stroke-width="0.8" opacity="0.5"/>`;
  }).join('');

  const aria = `${kpis.map((k) => `${k.value} ${k.label}`).join(' · ')}；语言分布 ${shown.map((l) => `${l.name} ${l.pct}%`).join(' / ')}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#06121F"/><stop offset="1" stop-color="#0A1B2E"/></linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#38BDF8"/><stop offset="1" stop-color="#38BDF8"/></linearGradient>
    <radialGradient id="gl"><stop offset="0" stop-color="#0EA5E9" stop-opacity="0.16"/><stop offset="1" stop-color="#0EA5E9" stop-opacity="0"/></radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    <clipPath id="clip"><rect width="${W}" height="${H}" rx="6"/></clipPath>
    <clipPath id="barclip"><rect x="${pad}" y="232" width="${barW}" height="11" rx="5.5"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <ellipse cx="880" cy="30" rx="380" ry="190" fill="url(#gl)"/>
    <g stroke="#1E4B6B" stroke-width="0.6" opacity="0.4">${grid.join('')}</g>
    <g stroke="#1E4B6B" stroke-width="0.9" opacity="0.32">${major.join('')}</g>
    <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.03"/>
    <text x="${pad}" y="30" font-family="${MONO}" font-size="11.5" letter-spacing="2.6" fill="#7D96AF">GITHUB STATS · @${LOGIN}</text>
    <text x="${W - pad}" y="30" text-anchor="end" font-family="${MONO}" font-size="11.5" letter-spacing="2.6" fill="#7D96AF">SINCE ${esc(since)}</text>
    <rect x="${pad}" y="40" width="${barW}" height="1.4" fill="url(#hair)" opacity="0.55"/>
    ${cols}
    <rect x="${pad}" y="202" width="${barW}" height="1" fill="url(#hair)" opacity="0.385"/>
    ${ticks}
    <text x="${pad}" y="222" font-family="${MONO}" font-size="10" letter-spacing="2.2" fill="#38BDF8">LANGUAGE DISTRIBUTION</text>
    <rect x="${pad}" y="232" width="${barW}" height="11" rx="5.5" fill="#0F2A42"/>
    <g clip-path="url(#barclip)">${segs.join('')}</g>
    ${legend}
  </g>
</svg>
`;
}

const data = await collect();
writeFileSync(OUT, build(data), 'utf8');
console.log(`wrote ${OUT}`);
console.log(`  ${data.kpis.map((k) => `${k.label}=${k.value}`).join('  ')}`);
console.log(`  langs: ${data.langs.slice(0, 6).map((l) => `${l.name} ${l.pct}%`).join(', ')}`);

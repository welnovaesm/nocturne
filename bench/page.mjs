// Deterministic benchmark page generator. Same input => byte-identical output.
// No randomness, no timestamps. Independent from the extension code.

export const ELEMENTS_PER_CARD = 20;
export const PRESET_SIZES = [100, 1000, 5000];
export const MAX_SIZE = 20000;

const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et',
  'dolore', 'magna', 'aliqua', 'enim', 'minim', 'veniam', 'quis', 'nostrud',
];

function words(seed, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(WORDS[(seed * 7 + i * 13) % WORDS.length]);
  return out.join(' ');
}

const PAGE_CSS = `
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #ffffff; color: #222222; }
  header.bench-header { padding: 16px 24px; background: #f3f4f6; border-bottom: 1px solid #d1d5db; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; padding: 24px; }
  .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
  .card h3 { margin: 0 0 8px; color: #111827; }
  .card p { color: #374151; }
  a { color: #1d4ed8; }
  a:visited { color: #6d28d9; }
  table.data { width: 100%; border-collapse: collapse; margin: 8px 0; }
  table.data th, table.data td { border: 1px solid #e5e7eb; padding: 4px 8px; text-align: left; }
  table.data tr:nth-child(even) { background: #f9fafb; }
  .actions { display: flex; gap: 8px; }
  .btn { background: #2563eb; color: #ffffff; border: 0; border-radius: 4px; padding: 6px 12px; }
  .btn.secondary { color: #1e3a8a; }
  .btn:hover { background: #1d4ed8; }
  .note { margin-top: 8px; padding: 6px 8px; border-radius: 4px; font-size: 14px; }
`;

// Exactly ELEMENTS_PER_CARD elements. Keep the count comments in sync when editing.
function card(i) {
  return `<article class="card" id="card-${i}">` + // 1
    `<h3>Card ${i}: ${words(i, 3)}</h3>` + // 2
    `<p>${words(i + 1, 12)} <a href="#card-${i}">${words(i + 2, 2)}</a> ` + // 3, 4
    `<strong>${words(i + 3, 2)}</strong> ${words(i + 4, 8)} ` + // 5
    `<a href="#card-${i + 1}">next</a>.</p>` + // 6
    `<table class="data"><tbody>` + // 7, 8
    `<tr><th>Key</th><td>${words(i + 5, 2)}</td><td style="color: #555555">${i * 3}</td></tr>` + // 9-12
    `<tr><th>Value</th><td>${words(i + 6, 2)}</td><td style="color: #b91c1c">${i * 7}</td></tr>` + // 13-16
    `</tbody></table>` +
    `<div class="actions">` + // 17
    `<button type="button" class="btn">Save</button>` + // 18
    `<button type="button" class="btn secondary" style="background-color: #dbeafe">Cancel</button>` + // 19
    `</div>` +
    `<div class="note" style="background-color: #fff8dc; border: 1px solid #e0c97f">${words(i + 7, 6)}</div>` + // 20
    `</article>`;
}

// Logs browser-reported timings. Identical in every scenario, so its own cost is a constant.
const METRICS_SCRIPT = `
  window.addEventListener('load', () => setTimeout(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const main = document.querySelector('main');
    const fmt = (v) => (v === undefined ? 'n/a' : v.toFixed(1) + 'ms');
    console.log('[bench] ' + [
      'elements=' + main.querySelectorAll('*').length,
      'domInteractive=' + fmt(nav && nav.domInteractive),
      'domContentLoaded=' + fmt(nav && nav.domContentLoadedEventEnd),
      'load=' + fmt(nav && nav.loadEventEnd),
      'fcp=' + fmt(fcp && fcp.startTime),
    ].join(' | '));
  }, 0));
`;

export function normalizeSize(n) {
  const value = Number.parseInt(String(n), 10);
  if (!Number.isFinite(value) || value < ELEMENTS_PER_CARD) return ELEMENTS_PER_CARD;
  return Math.min(Math.ceil(value / ELEMENTS_PER_CARD) * ELEMENTS_PER_CARD, MAX_SIZE);
}

/**
 * Returns the page split in two parts so the server can delay the body
 * (useful to make the initial-load flash observable).
 */
export function renderPage(size) {
  const n = normalizeSize(size);
  const cards = n / ELEMENTS_PER_CARD;

  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="bench-elements" content="${n}">
<title>Nocturne bench — ${n} elements</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="bench-header"><h1>Nocturne benchmark</h1><p>${n} generated elements (${cards} cards).</p></header>
`;

  let body = '<main>';
  for (let i = 0; i < cards; i++) body += card(i);
  body += `</main>\n<script>${METRICS_SCRIPT}</script>\n</body>\n</html>\n`;

  return { head, body, n };
}

// ANSI escape code to HTML converter
export function ansiToHtml(text) {
  if (!text) return '';

  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const ansiColors = {
    '1': 'font-weight: bold;',
    '2': 'opacity: 0.7;',
    '3': 'font-style: italic;',
    '4': 'text-decoration: underline;',

    // Standard foreground
    '30': 'color: #64748b;',
    '31': 'color: #f87171;',
    '32': 'color: #4ade80;',
    '33': 'color: #fbbf24;',
    '34': 'color: #60a5fa;',
    '35': 'color: #c084fc;',
    '36': 'color: #38bdf8;',
    '37': 'color: #f1f5f9;',

    // Bright foreground
    '90': 'color: #94a3b8;',
    '91': 'color: #ef4444;',
    '92': 'color: #22c55e;',
    '93': 'color: #eab308;',
    '94': 'color: #3b82f6;',
    '95': 'color: #a855f7;',
    '96': 'color: #06b6d4;',
    '97': 'color: #ffffff;',

    // Standard background
    '40': 'background-color: #0f172a;',
    '41': 'background-color: #7f1d1d;',
    '42': 'background-color: #14532d;',
    '43': 'background-color: #713f12;',
    '44': 'background-color: #1e3a8a;',
    '45': 'background-color: #581c87;',
    '46': 'background-color: #164e63;',
    '47': 'background-color: #334155;'
  };

  // Convert ANSI escape codes
  let openSpans = 0;
  html = html.replace(/\x1b\[([0-9;]+)m/g, (match, codes) => {
    if (codes === '0') {
      let close = '</span>'.repeat(openSpans);
      openSpans = 0;
      return close;
    }

    const codeList = codes.split(';');
    let style = '';
    for (const code of codeList) {
      if (ansiColors[code]) {
        style += ansiColors[code] + ' ';
      }
    }

    if (style) {
      openSpans++;
      return `<span style="${style.trim()}">`;
    }
    return '';
  });

  html += '</span>'.repeat(openSpans);
  return html;
}

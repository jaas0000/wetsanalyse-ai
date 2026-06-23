/**
 * Bundelt index.html + graph.json tot één zelfstandig HTML-bestand.
 * Gebruik: node bundle.js [uitvoernaam]
 * Standaard uitvoer: afgeleid van de wetten in graph.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));

const graphPad = join(dir, 'graph.json');
const htmlPad  = join(dir, 'index.html');

let graphJson, html;
try { graphJson = readFileSync(graphPad, 'utf-8'); }
catch { console.error('Fout: graph.json niet gevonden. Draai eerst npx tsx extract.ts.'); process.exit(1); }
try { html = readFileSync(htmlPad, 'utf-8'); }
catch { console.error('Fout: index.html niet gevonden.'); process.exit(1); }

// Injecteer de graph-data vóór </head> als inline script-variabele
const injectScript = `<script>window.__GRAPH_DATA__=${graphJson};</script>`;
if (!html.includes('</head>')) { console.error('Fout: </head> niet gevonden in index.html'); process.exit(1); }
const gebundeld = html.replace('</head>', `${injectScript}\n</head>`);

function naamVanGraph(jsonTekst) {
  try {
    const meta = JSON.parse(jsonTekst).metadata;
    const wetten = meta?.wetten ?? (meta?.wet ? [{ citeertitel: meta.wet }] : []);
    const slug = wetten
      .map(w => w.citeertitel
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''))
      .join('--');
    return `kennisgraaf-${slug || 'onbekend'}.html`;
  } catch {
    return 'kennisgraaf.html';
  }
}

const uitvoerNaam = process.argv[2] ?? naamVanGraph(graphJson);
const uitvoerPad  = join(dir, uitvoerNaam);
writeFileSync(uitvoerPad, gebundeld, 'utf-8');

const kb = Math.round(Buffer.byteLength(gebundeld, 'utf-8') / 1024);
console.log(`Klaar: ${uitvoerPad} (${kb} KB)`);
console.log('Stuur dit ene bestand op — ontvanger opent het in elke moderne browser.');
console.log('Let op: de graaf-library (3d-force-graph) wordt van unpkg.com geladen, dus');
console.log('voor het renderen is een internetverbinding nodig (de data zelf zit ingebed).');

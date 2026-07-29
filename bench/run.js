#!/usr/bin/env node
// Node/Playwright driver for the AI-tuning simulation bench. Internal
// dev tool - see bench/README.md for what this is and who's meant to run
// it. Starts its own static server, opens bench.html, runs a batch of
// headless bot-vs-bot matches via window.__BENCH__.runBatch() (a single
// page.evaluate() call - no per-match round trips), writes JSONL.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const REPO_ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png'
};

function printHelp() {
  console.log(`
Usage: node bench/run.js [options]

  --matchup <lvl:lvl[:lvl[:lvl]],...>   Comma-separated matchups, each
                                  2-4 colon-separated aiLevels (one per
                                  bot in that free-for-all). Valid
                                  levels: easy, medium, hard. Default: medium:medium
  --matches <N>                  Matches per matchup. Default: 60
  --map <chillForest|desert|random>   Default: random
  --wind <none|light|strong|random>   Default: random
  --seed <N>                     Optional PRNG seed - use the same seed on
                                  two runs to A/B a tuning change with the
                                  same terrain/tank-picks/wind sequence.
  --out <path>                   Output JSONL path. Default: a timestamped
                                  file under the OS temp dir (not the repo).

Examples:
  node bench/run.js --matchup medium:medium --matches 60
  node bench/run.js --matchup easy:easy,medium:medium,hard:hard --matches 40 --seed 42
  node bench/run.js --matchup medium:medium:hard --matches 60
  node bench/run.js --matchup easy:medium:hard:hard --matches 40
`);
}

function parseArgs(argv) {
  const args = { matchup: 'medium:medium', matches: 60, map: 'random', wind: 'random', seed: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matchup') args.matchup = argv[++i];
    else if (a === '--matches') args.matches = parseInt(argv[++i], 10);
    else if (a === '--map') args.map = argv[++i];
    else if (a === '--wind') args.wind = argv[++i];
    else if (a === '--seed') args.seed = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('Unknown argument: ' + a); printHelp(); process.exit(1); }
  }
  return args;
}

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found: ' + urlPath); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matchups = args.matchup.split(',').map((entry) => {
    const levels = entry.split(':').filter(Boolean);
    if (levels.length < 2 || levels.length > 4) {
      throw new Error('Bad --matchup entry: "' + entry + '" (expected 2-4 colon-separated aiLevels)');
    }
    return { levels };
  });

  const outPath = args.out || path.join(os.tmpdir(), `party-tanks-bench-${Date.now()}.jsonl`);

  const server = await startServer(REPO_ROOT);
  const port = server.address().port;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 926, height: 428 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  await page.goto(`http://127.0.0.1:${port}/bench.html`);

  const config = {
    matchups,
    matchesPerMatchup: args.matches,
    mapPolicy: args.map,
    windPolicy: args.wind,
    seed: args.seed
  };

  const totalMatches = matchups.length * args.matches;
  console.log(`Running ${matchups.length} matchup(s) x ${args.matches} matches = ${totalMatches} total...`);
  const t0 = Date.now();
  const log = await page.evaluate((cfg) => window.__BENCH__.runBatch(cfg), config);
  const elapsedS = (Date.now() - t0) / 1000;

  await browser.close();
  server.close();

  fs.writeFileSync(outPath, log.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const matchEnds = log.filter((e) => e.type === 'match_end');
  const completed = matchEnds.filter((e) => e.completed).length;
  const errored = log.filter((e) => e.type === 'error').length;

  console.log(`Done in ${elapsedS.toFixed(2)}s. ${completed}/${totalMatches} matches completed` +
    (errored ? `, ${errored} failed to set up` : '') + '.');
  console.log(`Output: ${outPath}`);
  if (pageErrors.length) {
    console.log(`\nWARNING: ${pageErrors.length} page error(s) - the bench or the game may be broken, not just the AI:`);
    pageErrors.slice(0, 5).forEach((e) => console.log('  ' + e));
  }
  console.log(`\nNext: node bench/analyze.js ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

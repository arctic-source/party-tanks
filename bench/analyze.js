#!/usr/bin/env node
// Reads a JSONL log produced by bench/run.js and prints aggregate stats.
// Internal dev tool - see bench/README.md.
//
// Usage: node bench/analyze.js <path-to.jsonl>
const fs = require('fs');

function pct(n, d) { return d === 0 ? 'n/a' : (100 * n / d).toFixed(1) + '%'; }
function ci95(hits, n) {
  if (n === 0) return 'n/a';
  const p = hits / n;
  const se = Math.sqrt(p * (1 - p) / n);
  return '±' + (100 * 1.96 * se).toFixed(1) + 'pp';
}
function pctile(sorted, f) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))]; }

const file = process.argv[2];
if (!file) {
  console.error('Usage: node bench/analyze.js <path-to.jsonl>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const events = lines.map((l) => JSON.parse(l));

const shots = events.filter((e) => e.type === 'shot');
const moves = events.filter((e) => e.type === 'move');
const matchStarts = events.filter((e) => e.type === 'match_start');
const matchEnds = events.filter((e) => e.type === 'match_end');
const errors = events.filter((e) => e.type === 'error');

console.log(`File: ${file}`);
console.log(`Matches: ${matchEnds.length} (${matchEnds.filter((m) => m.completed).length} completed, ${errors.length} failed setup)`);
console.log(`Shots: ${shots.length}, Moves: ${moves.length}\n`);

// ---------- Per-matchup outcomes ----------
console.log('=== Match outcomes by matchup ===');
const byMatchup = {};
matchStarts.forEach((ms) => {
  const key = ms.matchup.p1 + ' vs ' + ms.matchup.p2;
  byMatchup[key] = byMatchup[key] || { matchIds: [], p1: ms.matchup.p1, p2: ms.matchup.p2 };
  byMatchup[key].matchIds.push(ms.matchId);
});
Object.keys(byMatchup).forEach((key) => {
  const info = byMatchup[key];
  const ends = matchEnds.filter((e) => info.matchIds.includes(e.matchId) && e.completed);
  const p1Wins = ends.filter((e) => e.winnerIdx === 0).length;
  const p2Wins = ends.filter((e) => e.winnerIdx === 1).length;
  const avgTurns = ends.reduce((a, e) => a + e.turns, 0) / ends.length;
  const avgShots = ends.reduce((a, e) => a + e.totalShots, 0) / ends.length;
  console.log(`${key}: N=${ends.length} | p1(${info.p1}) wins ${p1Wins} (${pct(p1Wins, ends.length)}), p2(${info.p2}) wins ${p2Wins} (${pct(p2Wins, ends.length)}) | avg turns=${avgTurns.toFixed(1)} avg shots=${avgShots.toFixed(1)}`);
});

// ---------- Shot precision ----------
console.log('\n=== Overall shot precision ===');
const hits = shots.filter((s) => s.hitOpponent).length;
console.log(`Overall hit rate: N=${shots.length} hits=${hits} (${pct(hits, shots.length)}) ${ci95(hits, shots.length)}`);

function shotNumWithin(sh) {
  // shot number for this shooter within this match - derived from turnIndex
  // ordering per (matchId, shooterIdx), since the log doesn't store it directly.
  return sh._shotNum;
}
const byMatchShooter = {};
shots.forEach((s) => {
  const key = s.matchId + ':' + s.shooterIdx;
  byMatchShooter[key] = byMatchShooter[key] || 0;
  byMatchShooter[key]++;
  s._shotNum = byMatchShooter[key];
});

const firstShots = shots.filter((s) => s._shotNum === 1);
const firstHits = firstShots.filter((s) => s.hitOpponent).length;
console.log(`First-shot hit rate: N=${firstShots.length} hits=${firstHits} (${pct(firstHits, firstShots.length)}) ${ci95(firstHits, firstShots.length)}`);

console.log('\n--- By shot number ---');
for (let n = 1; n <= 6; n++) {
  const s = shots.filter((x) => shotNumWithin(x) === n);
  if (!s.length) continue;
  const h = s.filter((x) => x.hitOpponent).length;
  console.log(`  shot #${n}: N=${s.length} hits=${h} (${pct(h, s.length)})`);
}

console.log('\n--- By memory/confidence state ---');
function confBucket(s) {
  if (!s.hadMemory) return 'no memory (first shot)';
  if (s.movedSinceLastShot < 40) return 'stayed put (<40px)';
  if (s.movedSinceLastShot < 120) return 'moved a little (40-120px)';
  return 'moved a lot (>=120px)';
}
const cbuckets = {};
shots.forEach((s) => {
  const b = confBucket(s);
  cbuckets[b] = cbuckets[b] || { n: 0, hits: 0, sd: [] };
  cbuckets[b].n++;
  if (s.hitOpponent) cbuckets[b].hits++;
  cbuckets[b].sd.push(s.stdDev);
});
Object.keys(cbuckets).forEach((b) => {
  const d = cbuckets[b];
  const avgSd = (d.sd.reduce((a, c) => a + c, 0) / d.sd.length).toFixed(1);
  console.log(`  ${b}: N=${d.n} hits=${d.hits} (${pct(d.hits, d.n)}), avg stdDev=${avgSd}px`);
});

console.log('\n--- By range (shooter-opponent distance) ---');
function rangeBucket(s) {
  if (s.distance <= 300) return 'close (<=300px)';
  if (s.distance <= 700) return 'mid (300-700px)';
  if (s.distance <= 1200) return 'far (700-1200px)';
  return 'very far (>1200px)';
}
const rbuckets = {};
shots.forEach((s) => {
  const b = rangeBucket(s);
  rbuckets[b] = rbuckets[b] || { n: 0, hits: 0 };
  rbuckets[b].n++;
  if (s.hitOpponent) rbuckets[b].hits++;
});
Object.keys(rbuckets).forEach((b) => {
  const d = rbuckets[b];
  console.log(`  ${b}: N=${d.n} hits=${d.hits} (${pct(d.hits, d.n)})`);
});

const distSorted = shots.map((s) => s.distance).sort((a, b) => a - b);
if (distSorted.length) {
  console.log(`\n  distance: min=${distSorted[0].toFixed(0)} p25=${pctile(distSorted, .25).toFixed(0)} median=${pctile(distSorted, .5).toFixed(0)} p75=${pctile(distSorted, .75).toFixed(0)} max=${distSorted[distSorted.length - 1].toFixed(0)}`);
  console.log(`  fraction of shots at distance <=700px (where range-tightening starts to matter): ${pct(shots.filter((s) => s.distance <= 700).length, shots.length)}`);
}

const sdSorted = shots.map((s) => s.stdDev).sort((a, b) => a - b);
if (sdSorted.length) {
  console.log(`\n  stdDev used: min=${sdSorted[0].toFixed(1)} p25=${pctile(sdSorted, .25).toFixed(1)} median=${pctile(sdSorted, .5).toFixed(1)} p75=${pctile(sdSorted, .75).toFixed(1)} max=${sdSorted[sdSorted.length - 1].toFixed(1)}`);
}

const missSorted = shots.filter((s) => !s.hitOpponent && s.missDistance != null).map((s) => s.missDistance).sort((a, b) => a - b);
if (missSorted.length) {
  console.log(`\n  miss distance (misses only): min=${missSorted[0].toFixed(0)} median=${pctile(missSorted, .5).toFixed(0)} p90=${pctile(missSorted, .9).toFixed(0)} max=${missSorted[missSorted.length - 1].toFixed(0)}`);
}

const byReason = {};
shots.forEach((s) => { byReason[s.reason || 'unknown'] = (byReason[s.reason || 'unknown'] || 0) + 1; });
console.log('\n  shot outcomes by reason: ' + Object.keys(byReason).map((r) => `${r}=${byReason[r]}`).join(', '));

// ---------- Shots-to-first-hit ----------
console.log('\n--- Shots-to-first-hit (per player per match) ---');
const firstHitAt = [];
Object.keys(byMatchShooter).forEach((key) => {
  const [matchId, shooterIdx] = key.split(':').map(Number);
  const theirShots = shots.filter((s) => s.matchId === matchId && s.shooterIdx === shooterIdx).sort((a, b) => a._shotNum - b._shotNum);
  const firstHit = theirShots.find((s) => s.hitOpponent);
  if (firstHit) firstHitAt.push(firstHit._shotNum);
});
if (firstHitAt.length) {
  const avg = firstHitAt.reduce((a, c) => a + c, 0) / firstHitAt.length;
  console.log(`  players landing >=1 hit: ${firstHitAt.length}/${Object.keys(byMatchShooter).length} (${pct(firstHitAt.length, Object.keys(byMatchShooter).length)})`);
  console.log(`  avg shot# of their first hit: ${avg.toFixed(2)}`);
}

// ---------- Movement behavior ----------
console.log('\n=== Movement behavior ===');
const byKind = {};
moves.forEach((m) => { byKind[m.kind] = (byKind[m.kind] || 0) + 1; });
console.log('By kind: ' + Object.keys(byKind).map((k) => `${k}=${byKind[k]} (${pct(byKind[k], moves.length)})`).join(', '));

const underThreatMoves = moves.filter((m) => m.underThreat && m.evadeRoll != null);
const evaded = underThreatMoves.filter((m) => m.kind === 'evade').length;
console.log(`Evade roll attempted (under threat + had fuel): N=${underThreatMoves.length}, evaded=${evaded} (${pct(evaded, underThreatMoves.length)}) - compare to configured evadeChance`);

const evadeDists = moves.filter((m) => m.kind === 'evade' && m.plannedDist != null).map((m) => m.plannedDist).sort((a, b) => a - b);
if (evadeDists.length) {
  console.log(`Evade planned distance: min=${evadeDists[0].toFixed(0)} median=${pctile(evadeDists, .5).toFixed(0)} max=${evadeDists[evadeDists.length - 1].toFixed(0)}`);
}

const unreachable = moves.filter((m) => m.kind === 'unreachable');
if (unreachable.length) {
  console.log(`Unreachable-drive frequency: ${unreachable.length}/${moves.length} (${pct(unreachable.length, moves.length)})`);
}

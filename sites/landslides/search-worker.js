const cache = new Map();
let indexPromise, generation = 0;
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

async function read(path) {
  const response = await fetch('./data/search/' + path + '?v=20260907-4');
  if (!response.ok) throw new Error('Search data could not be loaded. Please try again.');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
}

function positions(term) {
  let first = 2166136261, second = 5381;
  for (const char of term) {
    first = Math.imul(first ^ char.codePointAt(0), 16777619) >>> 0;
    second = (Math.imul(second, 33) ^ char.codePointAt(0)) >>> 0;
  }
  return [first % 65536, second % 65536];
}

async function shardRecords(file) {
  if (!cache.has(file)) {
    const data = await read(file);
    cache.set(file, data.records);
    while (cache.size > 20) cache.delete(cache.keys().next().value);
  }
  return cache.get(file);
}

self.onmessage = async ({ data: { query, request } }) => {
  const current = ++generation;
  const term = normalize(query.trim());
  const chars = Array.from(term);
  if (chars.length < 3) { self.postMessage({ request, records: [], done: true }); return; }
  try {
    indexPromise ||= read('index.json.gz').catch(error => { indexPromise = null; throw error; });
    const index = await indexPromise;
    if (current !== generation) return;
    const hashes = new Set();
    for (let i = 0; i < chars.length - 2; i++) for (const hash of positions(chars.slice(i, i + 3).join(''))) hashes.add(hash);
    const candidates = index.shards.filter(shard => {
      const bytes = atob(shard.bloom);
      return [...hashes].every(hash => bytes.charCodeAt(Math.floor(hash / 8)) & (1 << (hash % 8)));
    });
    let count = 0, scanned = 0;
    for (const shard of candidates) {
      const rows = await shardRecords(shard.file);
      if (current !== generation) return;
      const matches = [];
      for (const row of rows) {
        const text = normalize([row[1], row[2], row[3], index.sources[row[4]]].map(value => String(value || '')).join(' '));
        if (!text.includes(term)) continue;
        matches.push(row); count++;
        if (count >= 50) break;
      }
      scanned++;
      self.postMessage({ request, records: matches, scanned, total: candidates.length, done: count >= 50 || scanned === candidates.length, limited: count >= 50 });
      if (count >= 50) return;
    }
    if (!candidates.length) self.postMessage({ request, records: [], done: true });
  } catch (error) {
    if (current === generation) self.postMessage({ request, error: error.message, done: true });
  }
};

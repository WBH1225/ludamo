// scan-ld-coverage-v2.js — 升级版LD覆盖盲区扫描
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const LD_DIR = path.join(BASE, '01-原始素材区', '完整副本', '对话');
const TYPES = ['QST', 'OPI', 'CON', 'CAS', 'SOL'];

// Collect all referenced LD IDs
const referencedLDs = new Set();
for (const type of TYPES) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    // source_documents: list
    const srcBlock = content.match(/^source_documents:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
    if (srcBlock) {
      const matches = srcBlock[1].match(/SRC-LD-\d+/g);
      if (matches) matches.forEach(m => referencedLDs.add(m));
    }
    // Body references
    const body = content.substring(content.indexOf('---', 3) + 3);
    const bodyRefs = body.match(/LD-\d+/g);
    if (bodyRefs) bodyRefs.forEach(r => referencedLDs.add('SRC-' + r));
  }
}
console.log(`已引用LD: ${referencedLDs.size}个`);

// Scan ALL LD files
const allLDs = {};
if (fs.existsSync(LD_DIR)) {
  for (const file of fs.readdirSync(LD_DIR)) {
    if (!file.endsWith('.md')) continue;
    const match = file.match(/LD-(\d+)/);
    if (!match) continue;
    const ldId = `SRC-LD-${match[1]}`;
    const content = fs.readFileSync(path.join(LD_DIR, file), 'utf-8');

    // Extract frontmatter
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = fmMatch ? fmMatch[1] : '';

    const weightMatch = fm.match(/^weight_score:\s*(\d+)/m);
    const weight = weightMatch ? parseInt(weightMatch[1]) : 0;

    const titleMatch = content.match(/# LD-\d+ · (.+)/) || content.match(/^title:\s*(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : file;

    const spectrum = (fm.match(/^spectrum:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
    const lock = (fm.match(/^lock_type:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
    const route = (fm.match(/^route_primary:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();

    const tagsMatch = fm.match(/^tags:\s*\[([^\]]+)\]/m);
    const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/"/g, '')) : [];

    allLDs[ldId] = { id: ldId, weight, title, spectrum, lock, route, tags, file, referenced: referencedLDs.has(ldId) };
  }
}

const totalLds = Object.keys(allLDs).length;
const unreferenced = Object.values(allLDs).filter(ld => !ld.referenced);
const highWeight = unreferenced.filter(ld => ld.weight >= 8).sort((a,b) => b.weight - a.weight);

console.log(`LD总数: ${totalLds}`);
console.log(`覆盖率: ${(referencedLDs.size/totalLds*100).toFixed(1)}%`);
console.log(`未引用≥8: ${highWeight.length}条`);
console.log(`未引用≥10: ${highWeight.filter(l=>l.weight>=10).length}条`);
console.log(`未引用≥12: ${highWeight.filter(l=>l.weight>=12).length}条`);

// Top 30 high-weight unreferenced
console.log(`\n=== Top 30 高权重未引用LD (⭐≥8) ===`);
for (const ld of highWeight.slice(0, 30)) {
  console.log(`  ⭐${ld.weight} ${ld.id.replace('SRC-','')}: ${ld.title.substring(0,60)}`);
  console.log(`      route:${ld.route} lock:${ld.lock} spectrum:${ld.spectrum} tags:${ld.tags.slice(0,5).join(',')}`);
}

// Tag clustering of high-weight unreferenced
console.log(`\n=== 高权重未引用LD的主题聚类 ===`);
const tagCount = {};
for (const ld of highWeight) {
  for (const tag of ld.tags) {
    tagCount[tag] = (tagCount[tag] || 0) + 1;
  }
}
const topTags = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0, 20);
for (const [tag, count] of topTags) {
  const samples = highWeight.filter(ld => ld.tags.includes(tag)).slice(0,3).map(l => l.id.replace('SRC-',''));
  console.log(`  ${tag}: ${count}条 [${samples.join(', ')}]`);
}

// Route distribution
console.log(`\n=== 高权重未引用LD的Route分布 ===`);
const routeCount = {};
for (const ld of highWeight) {
  routeCount[ld.route] = (routeCount[ld.route] || 0) + 1;
}
for (const [r, c] of Object.entries(routeCount).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${r}: ${c}条`);
}

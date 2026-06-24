// full-ld-mining.js — 全量904条LD挖掘，按主题聚类+提取候选内容单元
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const LD_DIR = path.join(BASE, '01-原始素材区', '完整副本', '对话');
const TYPES = ['QST', 'OPI', 'CON', 'CAS', 'SOL'];

// 1. Collect all referenced LD IDs
const referencedLDs = new Set();
for (const type of TYPES) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const srcBlock = content.match(/^source_documents:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
    if (srcBlock) {
      const matches = srcBlock[1].match(/SRC-LD-\d+/g);
      if (matches) matches.forEach(m => referencedLDs.add(m));
    }
    const body = content.substring(content.indexOf('---', 3) + 3);
    const bodyRefs = body.match(/LD-\d+/g);
    if (bodyRefs) bodyRefs.forEach(r => referencedLDs.add('SRC-' + r));
  }
}

// 2. Collect all existing content unit themes, titles, and core_claims for dedup
const existingThemes = new Set();
const existingTitles = new Set();
const existingClaims = [];
for (const type of TYPES) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const themeMatch = content.match(/^themes:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
    if (themeMatch) {
      const ts = themeMatch[1].match(/-\s*(.+)/g);
      if (ts) ts.forEach(t => existingThemes.add(t.replace(/-\s*/, '').trim()));
    }
    const titleMatch = content.match(/^title:\s*(.+)/m);
    if (titleMatch) existingTitles.add(titleMatch[1].trim());
    const claimMatch = content.match(/^core_claim:\s*(.+)/m);
    if (claimMatch) existingClaims.push(claimMatch[1].trim().substring(0, 80));
  }
}

// 3. Scan ALL LDs and extract patterns
const allLDs = [];
if (fs.existsSync(LD_DIR)) {
  for (const file of fs.readdirSync(LD_DIR)) {
    if (!file.endsWith('.md')) continue;
    const match = file.match(/LD-(\d+)/);
    if (!match) continue;
    const ldId = `SRC-LD-${match[1]}`;
    const content = fs.readFileSync(path.join(LD_DIR, file), 'utf-8');

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = fmMatch ? fmMatch[1] : '';

    const weightMatch = fm.match(/^weight_score:\s*(\d+)/m);
    const weight = weightMatch ? parseInt(weightMatch[1]) : 0;

    const spectrum = (fm.match(/^spectrum:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
    const lock = (fm.match(/^lock_type:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
    const route = (fm.match(/^route_primary:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();

    const tagsMatch = fm.match(/^tags:\s*\[([^\]]+)\]/m);
    const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/"/g, '')) : [];

    const patterns = (fm.match(/^index_sentence_pattern:\s*\[([^\]]*)\]/m) || ['',''])[1]
      .split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);

    // Extract key sentence (L1 line from body)
    const body = content.substring(content.indexOf('---', 3) + 3);
    const l1Match = body.match(/\*\*L1\*\*\s*["“]?(.+?)["”]?(?:\n|\*\*|$)/);
    const keySentence = l1Match ? l1Match[1].trim().substring(0, 120) : '';

    // Extract 被动/缺失 pattern
    const passiveMatch = body.match(/\*\*被动\*\*[：:]\s*(.+?)(?:\n|$)/);
    const passive = passiveMatch ? passiveMatch[1].trim().substring(0, 100) : '';

    const referenced = referencedLDs.has(ldId);

    allLDs.push({
      id: ldId, num: parseInt(match[1]), weight, spectrum, lock, route,
      tags, patterns, keySentence, passive, referenced,
      file
    });
  }
}

// 4. Sort by weight descending
allLDs.sort((a, b) => b.weight - a.weight);

// 5. Cluster unreferenced LDs by dominant theme
const themeBuckets = {};
const unreferenced = allLDs.filter(ld => !ld.referenced);

for (const ld of unreferenced) {
  const primaryTheme = ld.tags[0] || 'other';
  if (!themeBuckets[primaryTheme]) themeBuckets[primaryTheme] = [];
  themeBuckets[primaryTheme].push(ld);
}

// 6. For each theme bucket, find candidate OPIs/CONs
// An OPI candidate = a cluster of LDs with a shared core claim pattern
// A CON candidate = a cluster of LDs defining a new concept

console.log(`=== 全量LD挖掘分析 ===`);
console.log(`总LD: ${allLDs.length}`);
console.log(`已引用: ${referencedLDs.size}`);
console.log(`未引用: ${unreferenced.length}`);
console.log(`高权重未引用(≥8): ${unreferenced.filter(l=>l.weight>=8).length}`);
console.log(`高权重未引用(≥10): ${unreferenced.filter(l=>l.weight>=10).length}`);

// 7. Top theme buckets by total weight
console.log(`\n=== 未引用LD主题桶排名 (按总权重) ===`);
const bucketScores = Object.entries(themeBuckets).map(([theme, lds]) => ({
  theme,
  count: lds.length,
  totalWeight: lds.reduce((s,l) => s + l.weight, 0),
  avgWeight: (lds.reduce((s,l) => s + l.weight, 0) / lds.length).toFixed(1),
  top3: lds.slice(0,3).map(l => `${l.id}(${l.keySentence?.substring(0,30)})`).join(' | ')
}));
bucketScores.sort((a,b) => b.totalWeight - a.totalWeight);

for (const b of bucketScores.slice(0, 30)) {
  console.log(`  ${b.theme}: ${b.count}条 总⭐${b.totalWeight} 均⭐${b.avgWeight}`);
  console.log(`    Top: ${b.top3}`);
}

// 8. Pattern clustering — find repeated key sentence patterns across LDs
console.log(`\n=== 可复用句式模式 (出现≥3次) ===`);
const patternCount = {};
for (const ld of unreferenced) {
  for (const p of ld.patterns) {
    if (p.length > 2) {
      patternCount[p] = (patternCount[p] || 0) + 1;
    }
  }
}
const topPatterns = Object.entries(patternCount)
  .filter(([p,c]) => c >= 3)
  .sort((a,b) => b[1]-a[1]);
for (const [pattern, count] of topPatterns.slice(0, 30)) {
  console.log(`  "${pattern}": ${count}次`);
}

// 9. Find CONcept candidates — LDs that define new ideas
console.log(`\n=== 潜在新CON概念候选 (高权重+独特标签组合) ===`);
// Look for LDs with unique tag combos not covered by existing CONs
const existingConThemes = new Set([
  '老登', '焦虑覆盖', '人力漏斗', '叙事翻转', '证伪思维',
  '价值交换', '阶段复利', '概念区分', '表演即教学', '人设边界',
  '叙事主权', '情不立事', '牛马道', '反身性', '逆向思维',
  '瓶颈定位', '环境决定论', '共识经济学', '保护模式',
  '产品第一性', '需求溯源', '渠道匹配', 'IP资产', '知识付费',
  '赛道选择', 'AI商业重构'
]);

const conceptCandidates = unreferenced
  .filter(ld => ld.weight >= 8)
  .filter(ld => {
    // Has a unique tag not covered by existing CONs
    const uniqueTags = ld.tags.filter(t => !existingConThemes.has(t) && !existingThemes.has(t));
    return uniqueTags.length >= 2;
  })
  .slice(0, 40);

for (const ld of conceptCandidates) {
  console.log(`  ⭐${ld.weight} ${ld.id}: ${ld.keySentence?.substring(0,60)}`);
  console.log(`    tags: ${ld.tags.join(', ')} | lock:${ld.lock} route:${ld.route}`);
}

// 10. Potential OPI candidates — high-weight LDs with strong standalone claims
console.log(`\n=== 潜在新OPI候选 (⭐≥9, 强声明句式) ===`);
const opiCandidates = unreferenced
  .filter(ld => ld.weight >= 9)
  .filter(ld => ld.keySentence && ld.keySentence.length > 15)
  .slice(0, 50);

for (const ld of opiCandidates) {
  const short = ld.keySentence.substring(0, 70);
  console.log(`  ⭐${ld.weight} ${ld.id}: "${short}"`);
  console.log(`    passive: ${ld.passive?.substring(0,60)} | tags: ${ld.tags.slice(0,4).join(',')}`);
}

// 11. Route distribution analysis
console.log(`\n=== 未引用LD Route分布 (高权重≥8) ===`);
const routeDist = {};
for (const ld of unreferenced.filter(l => l.weight >= 8)) {
  routeDist[ld.route] = (routeDist[ld.route] || 0) + 1;
}
for (const [r, c] of Object.entries(routeDist).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${r}: ${c}条`);
}

// 12. Spectrum distribution
console.log(`\n=== 未引用LD自知光谱分布 (高权重≥8) ===`);
const spectrumDist = {};
for (const ld of unreferenced.filter(l => l.weight >= 8)) {
  const s = ld.spectrum.substring(0, 20);
  spectrumDist[s] = (spectrumDist[s] || 0) + 1;
}
for (const [s, c] of Object.entries(spectrumDist).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${s}: ${c}条`);
}

// smart-mine.js — 智能挖掘：逐条提取核心声明+去重+优先级排序
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const LD_DIR = path.join(BASE, '01-原始素材区', '完整副本', '对话');

// 1. Build comprehensive existing-content index
const existingIndex = { claims: new Set(), titles: new Set(), themes: new Set(), keywords: new Set() };
for (const type of ['QST','OPI','CON','CAS','SOL']) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const cm = content.match(/^core_claim:\s*(.+)/m);
    if (cm) existingIndex.claims.add(cm[1].trim().substring(0, 80));
    const tm = content.match(/^title:\s*(.+)/m);
    if (tm) existingIndex.titles.add(tm[1].trim());
    const thm = content.match(/^themes:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
    if (thm) {
      const ts = thm[1].match(/-\s*(.+)/g);
      if (ts) ts.forEach(t => existingIndex.themes.add(t.replace(/-\s*/, '').trim()));
    }
    const kwm = content.match(/^keywords:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
    if (kwm) {
      const ks = kwm[1].match(/-\s*(.+)/g);
      if (ks) ks.forEach(k => existingIndex.keywords.add(k.replace(/-\s*/, '').trim()));
    }
  }
}

// Collect referenced LDs
const referencedLDs = new Set();
for (const type of ['QST','OPI','CON','CAS','SOL']) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const mb = content.match(/^source_documents:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
    if (mb) { const m = mb[1].match(/SRC-LD-\d+/g); if (m) m.forEach(x => referencedLDs.add(x)); }
    const body = content.substring(content.indexOf('---', 3) + 3);
    const br = body.match(/LD-\d+/g);
    if (br) br.forEach(r => referencedLDs.add('SRC-' + r));
  }
}

// 2. Mine each unreferenced LD
const candidates = [];
for (const file of fs.readdirSync(LD_DIR)) {
  if (!file.endsWith('.md')) continue;
  const ldMatch = file.match(/LD-(\d+)/);
  if (!ldMatch) continue;
  const ldId = `SRC-LD-${ldMatch[1]}`;
  if (referencedLDs.has(ldId)) continue;

  const content = fs.readFileSync(path.join(LD_DIR, file), 'utf-8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = fmMatch ? fmMatch[1] : '';
  const body = content.substring(content.indexOf('---', 3) + 3);

  const weight = parseInt((fm.match(/^weight_score:\s*(\d+)/m) || ['',0])[1]) || 0;
  if (weight < 5) continue; // Skip very low weight

  const lock = (fm.match(/^lock_type:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
  const route = (fm.match(/^route_primary:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
  const tagsM = fm.match(/^tags:\s*\[([^\]]+)\]/m);
  const tags = tagsM ? tagsM[1].split(',').map(t => t.trim().replace(/"/g, '')) : [];

  // Extract core claim (L1 sentence)
  const l1 = body.match(/\*\*L1\*\*\s*[""](.+?)[""](?:\s*\*\*|\n|$)/);
  let claim = l1 ? l1[1].trim() : '';
  if (!claim) {
    const l1b = body.match(/\*\*L1\*\*\s*(.+?)(?:\n|$)/);
    claim = l1b ? l1b[1].trim().replace(/^[""]|[""]$/g, '').substring(0, 120) : '';
  }

  // Extract passive/missing pattern
  const passive = body.match(/\*\*被动\*\*[：:]\s*(.+?)(?:\n|$)/);
  const passiveText = passive ? passive[1].trim().substring(0, 100) : '';

  // Compute novelty score: how many unique themes/tags vs existing
  const novelTags = tags.filter(t => !existingIndex.themes.has(t) && !existingIndex.keywords.has(t));
  const noveltyScore = novelTags.length * 3 + (tags.filter(t => !existingIndex.keywords.has(t)).length);

  // Compute claim uniqueness (simple overlap check)
  let claimNovel = claim.length > 15;
  for (const ec of existingIndex.claims) {
    const overlap = [...claim.substring(0, 40)].filter((c, i) => ec.includes(claim.substring(i, i + 20))).length;
    if (overlap > 2) { claimNovel = false; break; }
  }

  // Determine potential type
  let potType = 'OPI';
  if (tags.some(t => ['概念借用', '行业规律对照', '生态思维'].includes(t))) potType = 'CON';
  if (route === '拆解' && passiveText.length > 10) potType = 'CAS';
  if (tags.includes('演示') && !passiveText && claim.length > 20) potType = 'OPI';

  const score = (weight * 2) + noveltyScore + (claimNovel ? 5 : 0);

  candidates.push({
    id: ldId, num: parseInt(ldMatch[1]), weight, lock, route,
    tags: tags.slice(0, 6), claim: claim.substring(0, 100), passive: passiveText,
    noveltyScore, claimNovel, potType, score
  });
}

// 3. Sort by score
candidates.sort((a, b) => b.score - a.score);

// 4. Output top candidates
console.log(`=== 智能挖掘结果 ===`);
console.log(`扫描未引用LD(weight≥5): ${candidates.length}条`);
console.log(`高新颖度候选: ${candidates.filter(c => c.claimNovel).length}条\n`);

// Top picks for OPI
console.log(`=== Top 20 OPI候选 ===`);
candidates.filter(c => c.potType === 'OPI' && c.claimNovel).slice(0, 20).forEach((c, i) => {
  console.log(`  ${i+1}. ⭐${c.weight} ${c.id} [score:${c.score}] "${c.claim.substring(0,70)}"`);
  console.log(`     tags: ${c.tags.join(', ')} | lock:${c.lock}`);
});

// Top picks for CON
console.log(`\n=== Top 10 CON候选 ===`);
candidates.filter(c => c.potType === 'CON' && c.claimNovel).slice(0, 10).forEach((c, i) => {
  console.log(`  ${i+1}. ⭐${c.weight} ${c.id} [score:${c.score}] "${c.claim.substring(0,70)}"`);
  console.log(`     tags: ${c.tags.join(', ')}`);
});

// Top picks for CAS
console.log(`\n=== Top 10 CAS候选 ===`);
candidates.filter(c => c.potType === 'CAS' && c.claimNovel).slice(0, 10).forEach((c, i) => {
  console.log(`  ${i+1}. ⭐${c.weight} ${c.id} [score:${c.score}] "${c.claim.substring(0,70)}"`);
  console.log(`     passive: ${c.passive.substring(0,60)}`);
});

console.log(`\n=== 统计 ===`);
console.log(`总候选(新颖+weight≥5): ${candidates.filter(c=>c.claimNovel).length}`);
console.log(`OPI新颖候选: ${candidates.filter(c=>c.potType==='OPI'&&c.claimNovel).length}`);
console.log(`CON新颖候选: ${candidates.filter(c=>c.potType==='CON'&&c.claimNovel).length}`);
console.log(`CAS新颖候选: ${candidates.filter(c=>c.potType==='CAS'&&c.claimNovel).length}`);

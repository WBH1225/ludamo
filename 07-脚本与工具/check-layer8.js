const fs = require('fs');
const path = require('path');

// ====== 1. QST-CON-SOL Triad Analysis ======
console.log('=== 1. QST三元组完整性 ===');
console.log('每个QST应至少有: 1个OPI回应 + 1个CON解释 + 1个SOL方案');
console.log('');

const allUnits = {};
['QST','OPI','CON','CAS','SOL'].forEach(sd => {
  const full = path.join('02-内容单元库', sd);
  if (!fs.existsSync(full)) return;
  fs.readdirSync(full).forEach(f => {
    if (!f.endsWith('.md')) return;
    const content = fs.readFileSync(path.join(full, f), 'utf8');
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return;
    const id = fm[1].match(/^id:\s*(.+)$/m);
    if (!id) return;
    const rels = [];
    const relSection = fm[1].match(/^relationships:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\r?\n?$)/m);
    if (relSection) {
      const blocks = relSection[1].split(/\r?\n\s*-/).filter(b => b.trim());
      blocks.forEach(b => {
        const t = b.match(/type:\s*(.+)/);
        const tg = b.match(/target:\s*(.+)/);
        if (t && tg) rels.push({type: t[1].trim(), target: tg[1].trim()});
      });
    }
    allUnits[id[1].trim()] = {
      type: sd,
      file: f,
      bodyLen: content.replace(/^---[\s\S]*?---/, '').trim().length,
      rels,
      keywords: (fm[1].match(/^keywords:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\r?\n?$)/m) || [''])[1]
    };
  });
});

// Check each QST's triad
const qsts = Object.entries(allUnits).filter(([id,u]) => u.type === 'QST');
qsts.forEach(([qstId, qst]) => {
  const opiCount = qst.rels.filter(r => r.target.startsWith('OPI-')).length;
  const conCount = qst.rels.filter(r => r.target.startsWith('CON-')).length;
  const solCount = qst.rels.filter(r => r.target.startsWith('SOL-')).length;
  const casCount = qst.rels.filter(r => r.target.startsWith('CAS-')).length;
  const issues = [];
  if (opiCount === 0) issues.push('缺OPI');
  if (conCount === 0) issues.push('缺CON');
  if (solCount === 0) issues.push('缺SOL');
  const status = issues.length === 0 ? '✅' : '❌ ' + issues.join(',');
  console.log(status + ' ' + qstId + ': OPI=' + opiCount + ' CON=' + conCount + ' SOL=' + solCount + ' CAS=' + casCount);
});

// ====== 2. Relationship Graph ======
console.log('');
console.log('=== 2. 关系图谱 ===');
const inDegree = {};
Object.values(allUnits).forEach(u => {
  u.rels.forEach(r => {
    if (allUnits[r.target]) {
      inDegree[r.target] = (inDegree[r.target] || 0) + 1;
    }
  });
});

const allIds = Object.keys(allUnits);
const zeroIn = allIds.filter(id => !inDegree[id] && allUnits[id].type !== 'QST');
const isolated = allIds.filter(id => !inDegree[id] && allUnits[id].rels.length === 0);

console.log('总节点: ' + allIds.length + ' | 总边: ' + Object.values(allUnits).reduce((s,u) => s + u.rels.length, 0));
console.log('孤立节点(无入无出): ' + isolated.length);
if (isolated.length > 0) isolated.forEach(id => console.log('  ❌ ' + id + ' (' + allUnits[id].type + ')'));
console.log('零入度非QST节点: ' + zeroIn.length);
if (zeroIn.length > 0) zeroIn.forEach(id => console.log('  ⚠️ ' + id + ' (' + allUnits[id].type + ') → ' + allUnits[id].file));

// Hub nodes
const hubs = Object.entries(inDegree).sort((a,b) => b[1] - a[1]).slice(0, 5);
console.log('Top 5 Hub节点:');
hubs.forEach(([id, deg]) => console.log('  ' + id + ': 入度=' + deg + ' (' + allUnits[id].type + ')'));

// ====== 3. LD Coverage ======
console.log('');
console.log('=== 3. LD覆盖盲区 ===');
const ldDir = '01-原始素材区/完整副本/对话';
const allLDs = fs.readdirSync(ldDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
const referencedLDs = new Set();

// Check all units' source_documents
Object.values(allUnits).forEach(u => {
  const content = fs.readFileSync(path.join('02-内容单元库', u.type, u.file), 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return;
  const srcs = fm[1].match(/-\s*SRC-(LD-\d+)/g);
  if (srcs) srcs.forEach(s => referencedLDs.add(s.replace('- SRC-', '').trim()));
});

// Also check topic maps for LD refs
fs.readdirSync('05-主题地图').forEach(f => {
  if (!f.endsWith('.md')) return;
  const content = fs.readFileSync(path.join('05-主题地图', f), 'utf8');
  const refs = content.match(/\[\[LD-\d+/g);
  if (refs) refs.forEach(r => referencedLDs.add(r.replace('[[', '')));
});

const unreferenced = allLDs.filter(ld => !referencedLDs.has(ld));
const coveragePct = ((referencedLDs.size / allLDs.length) * 100).toFixed(1);
console.log('总LD: ' + allLDs.length + ' | 被引用: ' + referencedLDs.size + ' (' + coveragePct + '%) | 未被引用: ' + unreferenced.length);
if (unreferenced.length > 0 && unreferenced.length < 20) {
  console.log('未引用LD:');
  unreferenced.forEach(ld => console.log('  - ' + ld));
}

// ====== 4. Content Depth ======
console.log('');
console.log('=== 4. 内容深度(正文字数) ===');
const byType = {};
Object.values(allUnits).forEach(u => {
  if (!byType[u.type]) byType[u.type] = [];
  byType[u.type].push({id: Object.keys(allUnits).find(k => allUnits[k] === u), len: u.bodyLen, file: u.file});
});
Object.entries(byType).forEach(([type, units]) => {
  const avg = Math.round(units.reduce((s,u) => s + u.len, 0) / units.length);
  const min = units.reduce((a,b) => a.len < b.len ? a : b);
  const max = units.reduce((a,b) => a.len > b.len ? a : b);
  console.log(type + ': avg=' + avg + '字 min=' + min.len + '(' + min.file + ') max=' + max.len + '(' + max.file + ')');
  if (min.len < 300) console.log('  ⚠️ 过短: ' + min.file + ' (' + min.len + '字)');
});

// ====== 5. Keyword Network ======
console.log('');
console.log('=== 5. 关键词重叠分析 ===');
const allKeywords = {};
Object.values(allUnits).forEach(u => {
  const content = fs.readFileSync(path.join('02-内容单元库', u.type, u.file), 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return;
  const kwSection = fm[1].match(/^keywords:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\r?\n?$)/m);
  if (kwSection) {
    const kws = kwSection[1].match(/-\s*(.+)/g);
    if (kws) kws.forEach(k => {
      const kw = k.replace(/-\s*/, '').trim();
      allKeywords[kw] = (allKeywords[kw] || 0) + 1;
    });
  }
});
const topKw = Object.entries(allKeywords).sort((a,b) => b[1] - a[1]).slice(0, 15);
const uniqueKw = Object.entries(allKeywords).filter(([k,v]) => v === 1);
console.log('总关键词(去重): ' + Object.keys(allKeywords).length + ' | 唯一关键词: ' + uniqueKw.length);
console.log('Top 15:');
topKw.forEach(([kw, c]) => console.log('  ' + kw + ': ' + c + '次'));
console.log('唯一关键词(仅1次): ' + uniqueKw.slice(0,10).map(([k]) => k).join(', ') + '...');

// ====== 6. OPI-CON mapping gaps ======
console.log('');
console.log('=== 6. OPI→CON 支撑缺口 ===');
const opis = Object.entries(allUnits).filter(([id,u]) => u.type === 'OPI');
opis.forEach(([opiId, opi]) => {
  const conRefs = opi.rels.filter(r => r.target.startsWith('CON-'));
  const qstRefs = opi.rels.filter(r => r.target.startsWith('QST-'));
  if (conRefs.length === 0 && qstRefs.length > 0) {
    console.log('  ⚠️ ' + opiId + ' 有QST回应但缺CON支撑');
  }
});

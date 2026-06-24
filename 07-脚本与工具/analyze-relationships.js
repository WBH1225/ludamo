// analyze-relationships.js — 分析所有内容单元的关系图谱
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const TYPES = ['QST', 'OPI', 'CON', 'CAS', 'SOL'];

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let inArray = false;
  let arrayItems = [];

  for (const line of lines) {
    // Check for list item under relationships or other array contexts
    if (inArray) {
      if (line.match(/^\s{2,}-/)) {
        arrayItems.push(line);
        continue;
      } else if (line.trim() === '') {
        continue;
      } else {
        // End of array
        if (currentKey) fm[currentKey] = arrayItems;
        inArray = false;
        arrayItems = [];
      }
    }

    const kv = line.match(/^(\w+):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '') {
        inArray = true;
        arrayItems = [];
      } else {
        fm[currentKey] = val;
      }
    }
  }
  if (inArray && currentKey) fm[currentKey] = arrayItems;

  // Parse relationships from array items
  if (fm.relationships && Array.isArray(fm.relationships)) {
    const rels = [];
    let currentRel = {};
    for (const item of fm.relationships) {
      const m = item.match(/^\s*-\s*type:\s*(.*)/);
      const t = item.match(/^\s*-\s*(\w+):\s*(.*)/);
      if (item.match(/^\s{4}- type:/)) {
        if (currentRel.type) rels.push({...currentRel});
        currentRel = {};
        const tm = item.match(/type:\s*(.*)/);
        if (tm) currentRel.type = tm[1].trim();
      } else if (item.match(/^\s{4}target:/)) {
        const tm = item.match(/target:\s*(.*)/);
        if (tm) currentRel.target = tm[1].trim();
      } else if (item.match(/^\s{4}note:/)) {
        const tm = item.match(/note:\s*(.*)/);
        if (tm) currentRel.note = tm[1].trim();
      }
    }
    if (currentRel.type) rels.push({...currentRel});
    fm._parsedRels = rels;
  }

  return fm;
}

// Collect all units
const allUnits = {};
for (const type of TYPES) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const fm = parseFrontmatter(content);
    allUnits[fm.id] = {
      id: fm.id,
      type: fm.type || type,
      title: fm.title || file.replace('.md', ''),
      relationships: fm._parsedRels || [],
      source_documents: fm.source_documents || '',
      themes: fm.themes || '',
      keywords: fm.keywords || '',
    };
  }
}

// 1. SOL→QST coverage (三元组: QST-SOL)
console.log('=== 1. QST→SOL 覆盖分析 ===');
const qsts = Object.values(allUnits).filter(u => u.type === '问题单元' || u.id.startsWith('QST'));
const sols = Object.values(allUnits).filter(u => u.type === '方案单元' || u.id.startsWith('SOL'));

// Find which SOL references which QST
const qstSolMap = {};
for (const sol of sols) {
  for (const rel of sol.relationships) {
    if (rel.target && rel.target.startsWith('QST')) {
      qstSolMap[rel.target] = (qstSolMap[rel.target] || []).concat(sol.id);
    }
  }
}

for (const qst of qsts.sort((a,b) => a.id.localeCompare(b.id))) {
  const covered = qstSolMap[qst.id] || [];
  console.log(`  ${qst.id} ${qst.title.substring(0,30)}... → ${covered.length ? covered.join(', ') : '❌无SOL覆盖'}`);
}

// 2. CON→CAS coverage
console.log('\n=== 2. CON→CAS 覆盖分析 ===');
const cons = Object.values(allUnits).filter(u => u.type === '概念单元' || u.id.startsWith('CON'));
const cases = Object.values(allUnits).filter(u => u.type === '案例单元' || u.id.startsWith('CAS'));

const conCasMap = {};
for (const cas of cases) {
  for (const rel of cas.relationships) {
    if (rel.target && rel.target.startsWith('CON') && rel.type === '说明') {
      conCasMap[rel.target] = (conCasMap[rel.target] || []).concat(cas.id);
    }
  }
}

for (const con of cons.sort((a,b) => a.id.localeCompare(b.id))) {
  const covered = conCasMap[con.id] || [];
  const business = con.id >= 'CON-020' ? ' [业务CON]' : ' [认知CON]';
  console.log(`  ${con.id}${business}: ${con.title.substring(0,30)}... → ${covered.length ? covered.join(', ') : '❌无CAS'}`);
}

// 3. OPI→CON 关系覆盖
console.log('\n=== 3. OPI→CON 关系覆盖分析 ===');
const opis = Object.values(allUnits).filter(u => u.type === '观点单元' || u.id.startsWith('OPI'));
const opiConMap = {};
for (const opi of opis) {
  for (const rel of opi.relationships) {
    if (rel.target && rel.target.startsWith('CON')) {
      opiConMap[opi.id] = (opiConMap[opi.id] || []).concat(`${rel.type}→${rel.target}`);
    }
  }
}

let opisWithoutCon = 0;
for (const opi of opis.sort((a,b) => a.id.localeCompare(b.id))) {
  const rels = opiConMap[opi.id] || [];
  if (!rels.length) {
    console.log(`  ${opi.id}: ${opi.title.substring(0,40)}... → ❌无CON关系`);
    opisWithoutCon++;
  }
}
console.log(`  OPI总数: ${opis.length}, 无CON关系: ${opisWithoutCon}`);

// 4. 孤立节点分析
console.log('\n=== 4. 孤立节点分析（出度为0且入度为0） ===');
const allRels = {}; // id -> {outgoing: [], incoming: []}
for (const unit of Object.values(allUnits)) {
  if (!allRels[unit.id]) allRels[unit.id] = {outgoing: [], incoming: []};
  for (const rel of unit.relationships) {
    if (rel.target && allUnits[rel.target]) {
      allRels[unit.id].outgoing.push(rel.target);
      if (!allRels[rel.target]) allRels[rel.target] = {outgoing: [], incoming: []};
      allRels[rel.target].incoming.push(unit.id);
    }
  }
}

let orphans = 0;
for (const [id, rels] of Object.entries(allRels)) {
  if (rels.outgoing.length === 0 && rels.incoming.length === 0) {
    console.log(`  🔴孤立: ${id} — 无出边无入边`);
    orphans++;
  }
}
console.log(`  孤立节点: ${orphans}`);

// 5. 关系类型统计
console.log('\n=== 5. 关系类型统计 ===');
const relTypeCount = {};
let totalRels = 0;
for (const unit of Object.values(allUnits)) {
  for (const rel of unit.relationships) {
    if (rel.target) {
      relTypeCount[rel.type] = (relTypeCount[rel.type] || 0) + 1;
      totalRels++;
    }
  }
}
for (const [type, count] of Object.entries(relTypeCount).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${type}: ${count}`);
}
console.log(`  总关系数: ${totalRels}`);

// 6. 入度分析（哪些节点被引用最多）
console.log('\n=== 6. 被引用最多的节点（入度Top 20） ===');
const inDegree = {};
for (const [id, rels] of Object.entries(allRels)) {
  inDegree[id] = rels.incoming.length;
}
const topIn = Object.entries(inDegree).sort((a,b) => b[1]-a[1]).slice(0, 20);
for (const [id, count] of topIn) {
  if (count > 0) {
    const unit = allUnits[id];
    console.log(`  ${id} (入度${count}): ${unit?.title?.substring(0,40) || ''}`);
  }
}

// 7. SOL solves 字段统计
console.log('\n=== 7. SOL→QST solves关系明细 ===');
for (const sol of sols.sort((a,b) => a.id.localeCompare(b.id))) {
  const qstRels = sol.relationships.filter(r => r.target && r.target.startsWith('QST'));
  if (qstRels.length > 0) {
    console.log(`  ${sol.id} → ${qstRels.map(r => r.target).join(', ')}`);
  }
}

// Output JSON for further processing
const summary = {
  total: Object.keys(allUnits).length,
  qst: qsts.length,
  opi: opis.length,
  con: cons.length,
  cas: cases.length,
  sol: sols.length,
  totalRelationships: totalRels,
  orphans,
  opisWithoutCon,
  qstWithoutSol: qsts.filter(q => !qstSolMap[q.id] || qstSolMap[q.id].length === 0).map(q => q.id),
  conWithoutCas: cons.filter(c => !conCasMap[c.id] || conCasMap[c.id].length === 0).map(c => c.id),
};
console.log('\n=== 8. 汇总JSON ===');
console.log(JSON.stringify(summary, null, 2));

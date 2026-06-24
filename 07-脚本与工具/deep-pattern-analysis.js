// deep-pattern-analysis.js — 深层规律统计 & 权重分配
// 分析所有内容单元的主题分布、关键词频率、CON支撑密度、权重层级

const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = '';
  for (let line of lines) {
    // List items
    if (/^\s{2,}-\s/.test(line)) {
      const val = line.replace(/^\s{2,}-\s*/, '').trim();
      if (currentKey && val) {
        if (!fm[currentKey]) fm[currentKey] = [];
        if (Array.isArray(fm[currentKey])) fm[currentKey].push(val);
      }
      continue;
    }
    // Key-value
    const kv = line.match(/^(\w+):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val && val !== '') {
        fm[currentKey] = val;
      } else {
        fm[currentKey] = '';
      }
    }
  }
  // Parse comma-separated lists
  for (let key of ['themes', 'keywords', 'source_documents', 'source_authors']) {
    if (typeof fm[key] === 'string' && fm[key]) {
      fm[key] = fm[key].split(',').map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(fm[key])) {
      fm[key] = fm[key].map(s => s.replace(/^\[|\]$/g, '').trim()).filter(Boolean);
    }
  }
  return fm;
}

function parseRelationships(fm, content) {
  const rels = [];
  const match = content.match(/^---\n[\s\S]*?\n---/);
  if (!match) return rels;
  const fmBlock = match[0];
  const relSection = fmBlock.match(/relationships:\n([\s\S]*?)(?:\n\w+:|$)/);
  if (!relSection) return rels;
  const lines = relSection[1].split('\n');
  let current = {};
  for (let line of lines) {
    const typeMatch = line.match(/type:\s*(.+)/);
    const targetMatch = line.match(/target:\s*(.+)/);
    if (typeMatch) current.type = typeMatch[1].trim();
    if (targetMatch) {
      current.target = targetMatch[1].trim();
      rels.push({...current});
      current = {};
    }
  }
  return rels;
}

const unitsDir = 'E:/鲁大魔思维知识库/鲁大魔Obsidian/02-内容单元库';
const types = ['OPI', 'CAS', 'CON', 'QST', 'SOL'];

// Collect all units
const units = [];
for (let type of types) {
  const dir = path.join(unitsDir, type);
  if (!fs.existsSync(dir)) continue;
  for (let file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    const rels = parseRelationships(fm, content);
    units.push({
      id: fm.id,
      type: fm.type,
      title: fm.title,
      themes: Array.isArray(fm.themes) ? fm.themes : (fm.themes ? [fm.themes] : []),
      keywords: Array.isArray(fm.keywords) ? fm.keywords : (fm.keywords ? [fm.keywords] : []),
      sourceDocs: fm.source_documents ? [].concat(fm.source_documents).flat() : [],
      relationships: rels,
      file: path.join(type, file)
    });
  }
}

console.log(`=== 深层规律分析 ===`);
console.log(`总单元数: ${units.length}\n`);

// 1. Theme frequency analysis
console.log(`--- 1. 主题频次 Top 20 ---`);
const themeCount = {};
for (let u of units) {
  for (let t of u.themes) {
    themeCount[t] = (themeCount[t] || 0) + 1;
  }
}
Object.entries(themeCount)
  .sort((a,b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([t,c]) => console.log(`  ${t}: ${c}次`));

// 2. Keyword frequency analysis
console.log(`\n--- 2. 关键词频次 Top 30 ---`);
const kwCount = {};
for (let u of units) {
  for (let k of u.keywords) {
    kwCount[k] = (kwCount[k] || 0) + 1;
  }
}
Object.entries(kwCount)
  .sort((a,b) => b[1] - a[1])
  .slice(0, 30)
  .forEach(([k,c]) => console.log(`  ${k}: ${c}次`));

// 3. Relationship type distribution by unit type
console.log(`\n--- 3. 关系方向分布 ---`);
const relDist = {};
for (let u of units) {
  const typeKey = u.type;
  if (!relDist[typeKey]) relDist[typeKey] = {};
  for (let r of u.relationships) {
    const targetType = r.target ? r.target.split('-')[0] : '?';
    const key = `${typeKey}→${targetType}`;
    relDist[typeKey][key] = (relDist[typeKey][key] || 0) + 1;
  }
}
for (let [type, dist] of Object.entries(relDist)) {
  const top = Object.entries(dist).sort((a,b) => b[1]-a[1]).slice(0,5);
  console.log(`  ${type}: ${top.map(([k,v]) => `${k}(${v})`).join(', ')}`);
}

// 4. CON 入度排名 (被多少OPI/CAS指向)
console.log(`\n--- 4. CON入度完整排名 ---`);
const conIndegree = {};
for (let u of units) {
  for (let r of u.relationships) {
    if (r.target && r.target.startsWith('CON-')) {
      conIndegree[r.target] = (conIndegree[r.target] || 0) + 1;
    }
  }
}
// Get CON titles
const conTitles = {};
for (let u of units) {
  if (u.type === '概念单元') conTitles[u.id] = u.title;
}
Object.entries(conIndegree)
  .sort((a,b) => b[1] - a[1])
  .forEach(([id, count]) => {
    const title = conTitles[id] || '';
    console.log(`  ${id} 入度${count}: ${title.substring(0,50)}`);
  });

// 5. 权重层级 (综合: 入度 × 关系数 × 类型系数)
console.log(`\n--- 5. 单元权重层级 Top 20 ---`);
const weights = units.map(u => {
  const outDegree = u.relationships.length;
  const inDegree = conIndegree[u.id] || 0;
  const typeCoef = { '概念单元': 3, '观点单元': 1.5, '案例单元': 2, '问题单元': 2, '方案单元': 2 }[u.type] || 1;
  const score = (inDegree * 2 + outDegree + typeCoef * 5).toFixed(1);
  return { id: u.id, type: u.type, title: u.title, inDegree, outDegree, score: parseFloat(score) };
});
weights.sort((a,b) => b.score - a.score);
weights.slice(0, 20).forEach(w => {
  console.log(`  ${w.id} [${w.type}] 权重${w.score}: 入度${w.inDegree} 出度${w.outDegree} | ${w.title.substring(0,40)}`);
});

// 6. 思维类型覆盖
console.log(`\n--- 6. 思维层聚类 ---`);
const thinkingClusters = {
  '证伪/验证': ['证伪', '验证', '行为证据', '数据', '周期', '测试'],
  '价值/交换': ['价值', '交换', '需求', '产品', '供应链', '定价', '成本'],
  '阶段/复利': ['阶段', '复利', '周期', '积累', '成长', '学习'],
  '赛道/选择': ['赛道', '选择', '行业', '入口', '方向', '转型'],
  '人性/身份': ['人性', '身份', '情绪', '自信', '投射', '懦弱', '幻想'],
  '叙事/框架': ['叙事', '框架', '翻转', '归因', '定义', '区分'],
  '资源/结构': ['资源', '结构', '资产', '资金', '融资', '投资'],
  '合规/底线': ['合规', '法律', '红线', '底线', '违法', '生存'],
};
for (let [cluster, keywords] of Object.entries(thinkingClusters)) {
  const matched = units.filter(u =>
    keywords.some(kw =>
      u.title.includes(kw) ||
      u.keywords.some(k => k.includes(kw)) ||
      u.themes.some(t => t.includes(kw))
    )
  );
  console.log(`  ${cluster}: ${matched.length}单元 (${(matched.length/units.length*100).toFixed(0)}%)`);
}

// 7. 内容深度分布（按OPI主题词聚类）
console.log(`\n--- 7. OPI内容主题簇 ---`);
const opis = units.filter(u => u.type === '观点单元');
const opiClusters = {};
for (let o of opis) {
  const mainTheme = o.themes[0] || '其他';
  opiClusters[mainTheme] = (opiClusters[mainTheme] || 0) + 1;
}
Object.entries(opiClusters)
  .sort((a,b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([t,c]) => console.log(`  ${t}: ${c}条OPI`));

console.log(`\n=== SUMMARY ===`);
console.log(JSON.stringify({
  totalUnits: units.length,
  conCount: units.filter(u => u.type === '概念单元').length,
  opiCount: opis.length,
  casCount: units.filter(u => u.type === '案例单元').length,
  qstCount: units.filter(u => u.type === '问题单元').length,
  solCount: units.filter(u => u.type === '方案单元').length,
  totalRels: units.reduce((s,u) => s + u.relationships.length, 0),
  topCon: Object.entries(conIndegree).sort((a,b) => b[1]-a[1]).slice(0,5).map(([id,c]) => ({id, indegree:c})),
}, null, 2));

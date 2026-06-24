// analyze-relationships-v2.js — 用更稳健的方式解析YAML frontmatter
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const TYPES = ['QST', 'OPI', 'CON', 'CAS', 'SOL'];

function parseYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{obj: root, indent: -1, key: null}];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }

    const indent = line.search(/\S|$/);
    const trimmed = line.trim();

    // Pop stack until we find the right parent
    while (stack.length > 1 && indent <= stack[stack.length-1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length-1];

    // Check if this is a list item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.substring(2).trim();
      const kv = value.match(/^(\w+):\s*(.*)/);
      if (kv) {
        // List of objects
        const newObj = {};
        newObj[kv[0]] = kv[2] || '';
        // Find or create list in parent
        if (!Array.isArray(parent.obj[parent.key])) {
          parent.obj[parent.key] = [];
        }
        parent.obj[parent.key].push(newObj);
        // Look ahead for more keys at deeper indentation
        stack.push({obj: newObj, indent, key: null});
        // Actually we need to handle this differently — the object is already pushed
        // The next lines at deeper indent should modify this object
      } else {
        // List of scalars
        if (!Array.isArray(parent.obj[parent.key])) {
          parent.obj[parent.key] = [];
        }
        parent.obj[parent.key].push(value);
      }
    } else {
      // Key-value pair
      const kv = trimmed.match(/^(\w+):\s*(.*)/);
      if (kv) {
        const key = kv[1];
        const val = kv[2].trim();
        if (val === '') {
          // Might be a nested object
          parent.obj[key] = {};
          stack.push({obj: parent.obj[key], indent, key});
        } else {
          parent.obj[key] = val;
        }
      }
    }
    i++;
  }

  return root;
}

// Alternative: just use manual line parsing with contextual awareness
function parseFrontmatter2(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const yamlText = match[1];
  const result = {};
  const lines = yamlText.split('\n');

  // Parse relationships manually with state machine
  let relationships = [];
  let inRelationships = false;
  let currentRel = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect relationships section start
    if (trimmed === 'relationships:') {
      inRelationships = true;
      continue;
    }

    if (inRelationships) {
      if (trimmed.startsWith('- type:')) {
        if (currentRel.type) {
          relationships.push({...currentRel});
        }
        currentRel = {type: trimmed.substring(7).trim()};
      } else if (trimmed.startsWith('target:')) {
        currentRel.target = trimmed.substring(7).trim();
      } else if (trimmed.startsWith('note:')) {
        currentRel.note = trimmed.substring(5).trim();
      } else if (trimmed === '---' || (trimmed !== '' && !trimmed.startsWith('-') && !trimmed.startsWith('target:') && !trimmed.startsWith('note:'))) {
        // End of relationships
        if (currentRel.type) {
          relationships.push({...currentRel});
        }
        inRelationships = false;
        currentRel = {};
      }
    }

    // Also capture solves field
    if (trimmed.startsWith('solves:')) {
      result._solves = trimmed.substring(7).trim();
    }
  }
  if (inRelationships && currentRel.type) {
    relationships.push({...currentRel});
  }

  result._relationships = relationships;
  return result;
}

// Collect units
const allUnits = {};
const allRelationships = []; // {from, type, to, note}
const unitList = [];

for (const type of TYPES) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const fm = parseFrontmatter2(content);

    const id = content.match(/^id:\s*(\S+)/m)?.[1] || file.replace('.md', '');
    const title = content.match(/^title:\s*(.+)/m)?.[1] || file;
    const unitType = content.match(/^type:\s*(.+)/m)?.[1] || type;

    const unit = {
      id,
      type: unitType,
      title,
      relationships: fm._relationships || [],
      solves: fm._solves || null,
    };

    allUnits[id] = unit;
    unitList.push(unit);

    for (const rel of fm._relationships || []) {
      allRelationships.push({from: id, type: rel.type, to: rel.target, note: rel.note || ''});
    }
    if (fm._solves) {
      allRelationships.push({from: id, type: '解决', to: fm._solves, note: ''});
    }
  }
}

console.log(`总单元数: ${unitList.length}`);
console.log(`总关系数: ${allRelationships.length}\n`);

// 1. SOL→QST coverage (includes 'solves' and '回应')
console.log('=== 1. QST→SOL 覆盖分析 ===');
const qstIds = unitList.filter(u => u.id.startsWith('QST')).map(u => u.id).sort();
const solIds = unitList.filter(u => u.id.startsWith('SOL')).map(u => u.id).sort();

const qstSolMap = {};
for (const rel of allRelationships) {
  if (rel.to.startsWith('QST') && rel.from.startsWith('SOL')) {
    qstSolMap[rel.to] = (qstSolMap[rel.to] || []).concat(rel.from);
  }
}

let qstWithoutSol = [];
for (const qid of qstIds) {
  const covered = qstSolMap[qid] || [];
  const unit = allUnits[qid];
  if (!covered.length) {
    console.log(`  ❌ ${qid}: ${unit.title.substring(0,50)}`);
    qstWithoutSol.push(qid);
  } else {
    console.log(`  ✅ ${qid} ← ${covered.join(', ')}`);
  }
}

// 2. CAS→CON coverage
console.log('\n=== 2. CON→CAS 覆盖分析 ===');
const conIds = unitList.filter(u => u.id.startsWith('CON')).map(u => u.id).sort();
const casIds = unitList.filter(u => u.id.startsWith('CAS')).map(u => u.id).sort();

const conCasMap = {};
for (const rel of allRelationships) {
  if (rel.to.startsWith('CON') && rel.from.startsWith('CAS') && (rel.type === '说明' || rel.type === '证明')) {
    conCasMap[rel.to] = (conCasMap[rel.to] || []).concat(rel.from);
  }
}

let conWithoutCas = [];
for (const cid of conIds) {
  const covered = conCasMap[cid] || [];
  const unit = allUnits[cid];
  const label = parseInt(cid.split('-')[1]) >= 20 ? '[业务]' : '[认知]';
  if (!covered.length) {
    console.log(`  ❌ ${cid} ${label}: ${unit.title.substring(0,45)}`);
    conWithoutCas.push(cid);
  } else {
    console.log(`  ✅ ${cid} ${label} ← ${covered.join(', ')}`);
  }
}

// 3. OPI→CON
console.log('\n=== 3. OPI→CON 关系覆盖 ===');
const opiIds = unitList.filter(u => u.id.startsWith('OPI')).map(u => u.id).sort();
let opisWithoutCon = [];
for (const oid of opiIds) {
  const conRels = allRelationships.filter(r => r.from === oid && r.to.startsWith('CON'));
  if (!conRels.length) {
    console.log(`  ❌ ${oid}: ${allUnits[oid].title.substring(0,50)}`);
    opisWithoutCon.push(oid);
  }
}
console.log(`  OPI总数: ${opiIds.length}, 无CON关系: ${opisWithoutCon.length}`);

// 4. 程度分析
console.log('\n=== 4. 关系网络度分析 ===');
const outDegree = {}, inDegree = {};
for (const rel of allRelationships) {
  outDegree[rel.from] = (outDegree[rel.from] || 0) + 1;
  inDegree[rel.to] = (inDegree[rel.to] || 0) + 1;
}

// 完全孤立(出度0且入度0)
let orphans = [];
for (const unit of unitList) {
  if (!outDegree[unit.id] && !inDegree[unit.id]) {
    orphans.push(unit.id);
  }
}
console.log(`  完全孤立节点: ${orphans.length}`);
if (orphans.length > 0 && orphans.length < 20) {
  orphans.forEach(id => console.log(`    ${id}: ${allUnits[id].title.substring(0,50)}`));
}

// 5. QST入度分析
console.log('\n=== 5. QST入度 ===');
for (const qid of qstIds) {
  const deg = inDegree[qid] || 0;
  console.log(`  ${qid} 入度=${deg}: ${allUnits[qid].title.substring(0,50)}`);
}

// 6. 关系类型分布
console.log('\n=== 6. 关系类型分布 ===');
const typeCount = {};
for (const rel of allRelationships) {
  typeCount[rel.type] = (typeCount[rel.type] || 0) + 1;
}
for (const [t, c] of Object.entries(typeCount).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${t}: ${c}`);
}

// 7. 入度Top 15
console.log('\n=== 7. 入度Top 15 ===');
const topIn = Object.entries(inDegree).sort((a,b) => b[1]-a[1]).slice(0, 15);
for (const [id, count] of topIn) {
  const unit = allUnits[id];
  if (unit) console.log(`  ${id} (入度${count}): ${unit.title.substring(0,45)}`);
}

// JSON summary
const summary = {
  totalUnits: unitList.length,
  totalRelationships: allRelationships.length,
  orphans: orphans.length,
  qstWithoutSol,
  conWithoutCas,
  opisWithoutCon,
};
console.log('\n=== SUMMARY JSON ===');
console.log(JSON.stringify(summary, null, 2));

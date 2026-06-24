const fs = require('fs');
const path = require('path');

const issues = [];
const allUnits = {}; // id -> {file, type, outRels: [{type, target}]}

// Parse all units
function parseUnits(baseDir) {
  const subdirs = ['QST','OPI','CON','CAS','SOL'];
  for (const sd of subdirs) {
    const full = path.join(baseDir, sd);
    if (!fs.existsSync(full)) continue;
    fs.readdirSync(full).forEach(f => {
      if (!f.endsWith('.md')) return;
      const content = fs.readFileSync(path.join(full, f), 'utf8');
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) return;
      const fm = fmMatch[1];
      const idMatch = fm.match(/^id:\s*(.+)$/m);
      const typeMatch = fm.match(/^type:\s*(.+)$/m);
      if (!idMatch) return;
      const id = idMatch[1].trim();
      const typeVal = typeMatch ? typeMatch[1].trim() : '?';
      const outRels = [];

      // Parse relationships
      const relSection = fm.match(/^relationships:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\r?\n?$)/m);
      if (relSection) {
        const blocks = relSection[1].split(/\r?\n\s*-/).filter(b => b.trim());
        for (const block of blocks) {
          const tMatch = block.match(/type:\s*(.+)/);
          const tgMatch = block.match(/target:\s*(.+)/);
          if (tMatch && tgMatch) {
            outRels.push({type: tMatch[1].trim(), target: tgMatch[1].trim()});
          }
        }
      }
      allUnits[id] = {file: path.join(sd, f), type: typeVal, outRels};
    });
  }
}
parseUnits('02-内容单元库');

// Check 1: Outgoing rel targets must exist
console.log('=== LAYER 2: 关系双向校验 ===');
console.log('总单元数:', Object.keys(allUnits).length);
console.log('');

let missingTargets = 0;
let missingInverse = 0;

for (const [id, unit] of Object.entries(allUnits)) {
  for (const rel of unit.outRels) {
    // Check target exists
    if (!allUnits[rel.target] && !rel.target.startsWith('LD-')) {
      console.log('❌ 缺失target: ' + id + ' → ' + rel.target + ' (' + rel.type + ')');
      missingTargets++;
    }

    // Check inverse relationship exists (bidirectional)
    if (allUnits[rel.target]) {
      const targetUnit = allUnits[rel.target];
      const hasInverse = targetUnit.outRels.some(r => r.target === id);
      if (!hasInverse) {
        // Some relationships don't need to be symmetric, but flag for review
        console.log('⚠️ 缺少反向关系: ' + id + ' →(' + rel.type + ')→ ' + rel.target + ' 但 ' + rel.target + ' 未回链到 ' + id);
        missingInverse++;
      }
    }
  }
}

if (missingTargets === 0 && missingInverse === 0) {
  console.log('✅ 关系完整：全部双向 + 全部target存在');
} else {
  console.log('');
  console.log('缺失target: ' + missingTargets + ' | 缺失反向关系: ' + missingInverse);
}

// Check 2: Orphan units (no incoming rels)
console.log('');
console.log('--- 入向关系统计 ---');
const incomingCount = {};
for (const [id, unit] of Object.entries(allUnits)) {
  for (const rel of unit.outRels) {
    if (allUnits[rel.target]) {
      incomingCount[rel.target] = (incomingCount[rel.target] || 0) + 1;
    }
  }
}

const orphans = Object.keys(allUnits).filter(id => !incomingCount[id]);
const topReferenced = Object.entries(incomingCount).sort((a,b) => b[1] - a[1]).slice(0, 5);

if (orphans.length > 0) {
  console.log('孤儿单元（无入向关系）: ' + orphans.length + '个');
  orphans.forEach(id => console.log('  - ' + id + ' (' + allUnits[id].type + ')'));
}
console.log('');
console.log('被引用最多:');
topReferenced.forEach(([id, count]) => console.log('  ' + id + ': ' + count + '次'));

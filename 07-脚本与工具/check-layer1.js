const fs = require('fs');
const path = require('path');

const issues = [];
const allUnitIds = new Set();

// Collect all content unit IDs first
function collectIds(baseDir) {
  const subdirs = ['QST','OPI','CON','CAS','SOL'];
  for (const sd of subdirs) {
    const full = path.join(baseDir, sd);
    if (!fs.existsSync(full)) continue;
    fs.readdirSync(full).forEach(f => {
      if (!f.endsWith('.md')) return;
      const content = fs.readFileSync(path.join(full, f), 'utf8');
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fmMatch) {
        const idMatch = fmMatch[1].match(/^id:\s*(.+)$/m);
        if (idMatch) allUnitIds.add(idMatch[1].trim());
      }
    });
  }
}
collectIds('02-内容单元库');

// Check each content unit
const requiredFields = ['id','type','title','canonical','version','source_documents','relationships'];
const validTypes = ['QST','OPI','CON','CAS','SOL'];
const validRels = ['回应','解释','证明','冲突'];

function checkUnit(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const shortPath = filePath.replace(/^\.\//, '').replace(/\\/g, '/');

  // Parse frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    issues.push({file: shortPath, issue: '无frontmatter'});
    return;
  }
  const fm = fmMatch[1];

  // Check required fields
  for (const field of requiredFields) {
    const re = new RegExp('^' + field + ':', 'm');
    if (!re.test(fm)) {
      issues.push({file: shortPath, issue: '缺少必填字段: ' + field});
    }
  }

  // Check type validity
  const typeMatch = fm.match(/^type:\s*(.+)$/m);
  if (typeMatch && !validTypes.includes(typeMatch[1].trim())) {
    issues.push({file: shortPath, issue: 'type值无效: ' + typeMatch[1].trim()});
  }

  // Check canonical is boolean
  const canMatch = fm.match(/^canonical:\s*(.+)$/m);
  if (canMatch && canMatch[1].trim() !== 'true' && canMatch[1].trim() !== 'false') {
    issues.push({file: shortPath, issue: 'canonical应为true/false，实际: ' + canMatch[1].trim()});
  }

  // Check version is number
  const verMatch = fm.match(/^version:\s*(.+)$/m);
  if (verMatch && isNaN(Number(verMatch[1].trim()))) {
    issues.push({file: shortPath, issue: 'version应为数字，实际: ' + verMatch[1].trim()});
  }

  // Check source_documents references
  const srcSection = fm.match(/^source_documents:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\r?\n?$)/m);
  if (srcSection) {
    const srcs = srcSection[1].match(/-\s*(.+)/g);
    if (srcs) srcs.forEach(s => {
      const srcId = s.replace(/-\s*/, '').trim();
      if (srcId.startsWith('SRC-')) {
        const ldId = srcId.replace('SRC-', '');
        const ldPath = path.join('01-原始素材区/完整副本/对话', ldId + '.md');
        if (!fs.existsSync(ldPath)) {
          issues.push({file: shortPath, issue: 'source_document不存在: ' + srcId});
        }
      }
    });
  }

  // Check relationships
  const relSection = fm.match(/^relationships:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\r?\n?$)/m);
  if (relSection) {
    const rels = relSection[1].split(/\r?\n\s*-/).filter(Boolean);
    for (const relBlock of rels) {
      const typeVal = relBlock.match(/type:\s*(.+)/);
      if (typeVal && !validRels.includes(typeVal[1].trim())) {
        issues.push({file: shortPath, issue: '关系类型无效: ' + typeVal[1].trim()});
      }
      const targetVal = relBlock.match(/target:\s*(.+)/);
      if (targetVal) {
        const t = targetVal[1].trim();
        if (!allUnitIds.has(t) && !t.startsWith('LD-')) {
          issues.push({file: shortPath, issue: '关系target不存在: ' + t});
        }
      }
    }
  }

  // Check for body content after frontmatter
  const afterFm = content.slice(fmMatch[0].length).trim();
  if (afterFm.length < 50) {
    issues.push({file: shortPath, issue: '正文过短: ' + afterFm.length + '字符'});
  }
}

function walkUnits(baseDir) {
  const subdirs = ['QST','OPI','CON','CAS','SOL'];
  for (const sd of subdirs) {
    const full = path.join(baseDir, sd);
    if (!fs.existsSync(full)) continue;
    fs.readdirSync(full).forEach(f => {
      if (f.endsWith('.md')) checkUnit(path.join(full, f));
    });
  }
}
walkUnits('02-内容单元库');

console.log('=== LAYER 1: Frontmatter & 结构完整性 ===');
console.log('已注册ID:', allUnitIds.size, '个');
console.log('问题数:', issues.length);
console.log('');
if (issues.length === 0) {
  console.log('✅ 全部通过');
} else {
  issues.forEach(i => console.log('❌ ' + i.file + '\n   ' + i.issue));
}

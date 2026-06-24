const fs = require('fs');
const path = require('path');

const issues = [];
const subdirs = ['QST','OPI','CON','CAS','SOL'];
const sectionLabels = {
  '核心内容': true, '来源依据': true, '使用场景': true, '关联单元': true,
  '底层逻辑': true, '操作公式': true, '适用条件': true, '常见变体': true,
  '案例': true, '步骤': true, '为什么有效': true, '概念定义': true,
  '翻转公式': true, '识别信号': true, '鲁大魔原话': true
};

function checkBody(filePath) {
  const shortPath = filePath.replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');

  // Split frontmatter from body
  const fmEnd = content.indexOf('\n---\n');
  if (fmEnd === -1) {
    const fmEnd2 = content.indexOf('\n---\r\n');
    if (fmEnd2 === -1) return;
  }
  const bodyStart = content.indexOf('---', 4) + 4;
  let body = content.slice(bodyStart).trim();

  // Check for TODO/FIXME/XXX/TK placeholder markers
  if (/TODO|FIXME|TK\b|待补|待写|XXX/.test(body)) {
    const matches = body.match(/TODO|FIXME|TK\b|待补|待写/g);
    issues.push({file: shortPath, issue: '含占位符标记: ' + [...new Set(matches)].join(', ')});
  }

  // Check for empty sections (## heading followed by blank or another heading)
  const sections = body.split(/^##\s+/gm);
  for (const sec of sections) {
    if (!sec.trim()) continue;
    const firstLine = sec.split('\n')[0].trim();
    const secBody = sec.slice(firstLine.length).trim();
    if (secBody.length < 20) {
      issues.push({file: shortPath, issue: '空/过短章节: ## ' + firstLine + ' (' + secBody.length + '字)'});
    }
  }

  // Check for bare markdown links without resolved filenames ([[SHORT-ID]])
  const shortWikiLinks = body.match(/\[\[([A-Z]+-\d+)\]\]/g);
  if (shortWikiLinks) {
    // Filter out code blocks
    const inCode = false;
    const cleanLinks = shortWikiLinks.filter(l => {
      // Skip if inside inline code
      return true; // All bare ID links are bad
    });
    if (cleanLinks.length > 0) {
      issues.push({file: shortPath, issue: '正文含裸ID链接: ' + cleanLinks.join(', ')});
    }
  }

  // Check body length
  if (body.length < 200) {
    issues.push({file: shortPath, issue: '正文过短: ' + body.length + '字符'});
  }
}

function walkUnits(baseDir) {
  for (const sd of subdirs) {
    const full = path.join(baseDir, sd);
    if (!fs.existsSync(full)) continue;
    fs.readdirSync(full).forEach(f => {
      if (f.endsWith('.md')) checkBody(path.join(full, f));
    });
  }
}
walkUnits('02-内容单元库');

// Also check topic maps
function checkMaps(dir) {
  fs.readdirSync(dir).forEach(f => {
    if (!f.endsWith('.md')) return;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const body = content.replace(/^---[\s\S]*?---/, '').trim();
    if (/TODO|FIXME|待补|待写/.test(body)) {
      issues.push({file: '05-主题地图/' + f, issue: '含占位符标记'});
    }
    const shortLinks = body.match(/\[\[([A-Z]+-\d+)\]\]/g);
    if (shortLinks) {
      issues.push({file: '05-主题地图/' + f, issue: '含裸ID链接: ' + [...new Set(shortLinks)].join(', ')});
    }
  });
}
checkMaps('05-主题地图');

// Check assembly drafts
function checkAssemblies(dir) {
  fs.readdirSync(dir).forEach(f => {
    if (!f.endsWith('.md')) return;
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const body = content.replace(/^---[\s\S]*?---/, '').trim();
    if (/TODO|FIXME|待补|待写/.test(body)) {
      issues.push({file: '06-选题装配/' + f, issue: '含占位符标记'});
    }
  });
}
checkAssemblies('06-选题装配');

console.log('=== LAYER 3: 正文质量 ===');
console.log('问题数:', issues.length);
console.log('');
if (issues.length === 0) {
  console.log('✅ 全部通过');
} else {
  issues.forEach(i => console.log('❌ ' + i.file + '\n   ' + i.issue));
}

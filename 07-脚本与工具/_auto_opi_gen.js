const fs = require('fs');
const d = require('./03-处理状态/LD挖掘数据.json');
const today = '2026-06-22';
const dir = './02-内容单元库/OPI/';

// Get referenced set
const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
const refSet = new Set();
allFiles.forEach(f => {
  const content = fs.readFileSync(dir + f, 'utf8');
  const matches = content.matchAll(/SRC-LD-(\d+)/g);
  for (const m of matches) refSet.add(parseInt(m[1]));
});

// Get max OPI ID
let maxId = 0;
allFiles.forEach(f => {
  const m = f.match(/OPI-(\d+)/);
  if (m) maxId = Math.max(maxId, parseInt(m[1]));
});

// Process weight=0 entries with existing files
const unref = Object.entries(d).filter(([k,v]) => {
  const num = v.num || parseInt(k);
  if (!num || num <= 0 || refSet.has(num)) return false;
  return fs.existsSync('./01-原始素材区/完整副本/对话/LD-' + num + '.md');
});

console.log('Processing ' + unref.length + ' remaining unreferenced LDs (all weights)...');

let nextId = maxId + 1;
let created = 0;
let skipped = 0;

unref.forEach(([k,v]) => {
  const num = v.num || parseInt(k);
  const filePath = './01-原始素材区/完整副本/对话/LD-' + num + '.md';
  const content = fs.readFileSync(filePath, 'utf8');

  // Extract title
  const titleMatch = content.match(/# LD-\d+ · (.+)/);
  const rawTitle = titleMatch ? titleMatch[1] : ('LD-' + num);

  // Extract key quote (L1 response)
  const l1Match = content.match(/\*\*L1\*\*\s+\*\"(.+?)\"\*/);
  let l1 = l1Match ? l1Match[1].replace(/\*\*/g,'') : '';
  if (!l1) {
    const altL1 = content.match(/\*\*L1\*\*\s+\*?(.+?)\*?\n/);
    if (altL1) l1 = altL1[1].replace(/\*"/g,'').replace(/"\*/g,'').replace(/\*/g,'').trim();
  }

  // Extract key quote
  const keyQuoteBlock = content.match(/🔑 \*\*拉出原句：\*\*\n>(.+?)(?:\n\n|\n\*\*|$)/s);
  let keyQuote = '';
  if (keyQuoteBlock) {
    keyQuote = keyQuoteBlock[1].replace(/\n>/g,' ').replace(/\*\*/g,'').replace(/> /g,'').trim().substring(0, 250);
  }

  // Extract thinking type
  const thinkingMatch = content.match(/\*\*思维类型：(.+?)\*\*/);
  const thinking = thinkingMatch ? thinkingMatch[1] : '';

  // Build core_claim (shorter for lower weights)
  let coreClaim = keyQuote || l1 || rawTitle;
  if (coreClaim.length < 8) { skipped++; return; }
  if (coreClaim.length > 300) coreClaim = coreClaim.substring(0, 300);

  // Build 核心
  let core = (l1 && l1.length > 10) ? l1.substring(0, 180) : coreClaim.substring(0, 150);

  // Themes from tags
  const tags = v.tags || [];
  const themes = new Set();
  tags.forEach(t => {
    if (['创业','商业','管理','学习','心智','自媒体'].includes(t)) themes.add(t);
  });
  if (themes.size === 0) { themes.add('创业'); themes.add('商业'); }
  const themeList = [...themes].slice(0, 2);

  // Keywords
  const keywords = tags.slice(0, 5);
  if (keywords.length === 0) keywords.push(rawTitle.substring(0, 20));

  // Title
  let title = rawTitle;
  if (title.length > 120) title = title.substring(0, 117) + '...';

  // Single CON relationship
  const relationships = [{
    type: '证明',
    target: 'CON-003',
    note: '第一性原理——' + (thinking ? thinking.substring(0, 60) : rawTitle.substring(0, 60))
  }];

  const opiId = 'OPI-' + nextId;
  nextId++;

  const yamlThemes = themeList.map(t => '  - ' + t).join('\n');
  const yamlKW = keywords.map(k => '  - ' + k).join('\n');
  const yamlRels = relationships.map(r =>
    '  - type: ' + r.type + '\n    target: ' + r.target + '\n    note: ' + r.note
  ).join('\n');

  const safeClaim = coreClaim.replace(/\n/g, ' ').replace(/"/g, "'");

  const opiContent = `---
id: ${opiId}
type: 观点单元
title: ${title}
source_documents:
  - SRC-LD-${num}
source_authors:
  - 鲁大魔
themes:
${yamlThemes}
keywords:
${yamlKW}
status: 待核对
canonical: true
version: 1
created_at: ${today}
updated_at: ${today}
core_claim: ${safeClaim}
relationships:
${yamlRels}
---
## 核心
${core}
`;

  const safeTitle = title.replace(/[\/\\:*?"<>|]/g,'-').substring(0, 100);
  const fname = opiId + '_' + safeTitle + '.md';
  fs.writeFileSync(dir + fname, opiContent, 'utf8');
  created++;

  if (created % 30 === 0) console.log('Progress: ' + created + '/' + unref.length);
});

console.log('Done! Created: ' + created + ', Skipped: ' + skipped + ', Final OPI: OPI-' + (nextId - 1));

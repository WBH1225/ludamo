// batch-mine-lds.js — 逐条挖掘未引用LD，提取结构化挖掘记录
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const LD_DIR = path.join(BASE, '01-原始素材区', '完整副本', '对话');
const OUTPUT = path.join(BASE, '03-处理状态', 'LD挖掘台账.md');

const TYPES = ['QST', 'OPI', 'CON', 'CAS', 'SOL'];

// Collect referenced LDs
const referencedLDs = new Set();
for (const type of TYPES) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const srcBlock = content.match(/^source_documents:\s*\n([\s\S]*?)(?=\n\w|\n$)/m);
    if (srcBlock) {
      const m = srcBlock[1].match(/SRC-LD-\d+/g);
      if (m) m.forEach(x => referencedLDs.add(x));
    }
    const body = content.substring(content.indexOf('---', 3) + 3);
    const br = body.match(/LD-\d+/g);
    if (br) br.forEach(r => referencedLDs.add('SRC-' + r));
  }
}

// Collect existing claims for dedup
const existingClaims = new Set();
for (const type of TYPES) {
  const dir = path.join(UNIT_DIR, type);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const cm = content.match(/^core_claim:\s*(.+)/m);
    if (cm) existingClaims.add(cm[1].trim().substring(0, 60));
  }
}

// Mine each unreferenced LD
const mined = [];
const files = fs.readdirSync(LD_DIR).filter(f => f.endsWith('.md'));

for (const file of files) {
  const ldMatch = file.match(/LD-(\d+)/);
  if (!ldMatch) continue;
  const ldId = `SRC-LD-${ldMatch[1]}`;
  if (referencedLDs.has(ldId)) continue; // skip already referenced

  const content = fs.readFileSync(path.join(LD_DIR, file), 'utf-8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = fmMatch ? fmMatch[1] : '';
  const body = content.substring(content.indexOf('---', 3) + 3);

  const weight = parseInt((fm.match(/^weight_score:\s*(\d+)/m) || ['',0])[1]) || 0;
  const lock = (fm.match(/^lock_type:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
  const route = (fm.match(/^route_primary:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();
  const spectrum = (fm.match(/^spectrum:\s*"?([^"\n]+)"?/m) || ['','?'])[1].trim();

  const tagsM = fm.match(/^tags:\s*\[([^\]]+)\]/m);
  const tags = tagsM ? tagsM[1].split(',').map(t => t.trim().replace(/"/g, '')) : [];

  // Extract key sentences
  const l1 = body.match(/\*\*L1\*\*\s*["“]?(.+?)["”]?(?:\s*\*\*|\n|$)/);
  const keySentence = l1 ? l1[1].trim().substring(0, 150) : '';

  // Extract passive pattern
  const passive = body.match(/\*\*被动\*\*[：:]\s*(.+?)(?:\n|$)/);
  const passiveText = passive ? passive[1].trim().substring(0, 120) : '';

  // Extract "缺的不是/缺的是" pattern
  const missing = body.match(/缺的不是[：:]*\s*(.+?)(?:\n|$)/);
  const missingText = missing ? missing[1].trim().substring(0, 100) : '';

  // Extract 框架植入
  const framework = body.match(/框架植入[：:]\s*(.+?)(?:\n|$)/);
  const frameworkText = framework ? framework[1].trim().substring(0, 100) : '';

  // Determine potential unit type
  let unitType = '';
  if (tags.some(t => ['演示', '软锁', '表演'].includes(t)) && keySentence.length > 20) {
    unitType = 'OPI'; // Strong standalone claim → OPI
  } else if (tags.some(t => ['概念借用', '行业规律对照'].includes(t))) {
    unitType = 'CON'; // New concept definition → CON
  } else if (route === '拆解' && passiveText.length > 10) {
    unitType = 'CAS'; // Problem-solution story → CAS
  }

  // Determine novelty vs existing claims
  const claimOverlap = keySentence ? [...existingClaims].some(c => {
    const words = c.split('').filter((_,i) => keySentence.includes(c.substring(i, i+20))).length;
    return false; // Simplified — just mark for review
  }) : false;

  mined.push({
    id: ldId, num: parseInt(ldMatch[1]), weight, lock, route, spectrum,
    tags: tags.slice(0, 6),
    keySentence,
    passive: passiveText,
    missing: missingText,
    framework: frameworkText,
    unitType,
    titleHint: keySentence.substring(0, 40),
  });
}

// Sort by weight descending
mined.sort((a, b) => b.weight - a.weight);

// Generate mining ledger in markdown
let md = `# LD挖掘台账\n\n`;
md += `> 自动生成于 2026-06-22 | 未引用LD: ${mined.length}条 | 已引用: ${referencedLDs.size}条\n\n`;
md += `---\n\n`;
md += `## 挖掘统计\n\n`;
md += `| 权重 | 数量 |\n`;
md += `|------|------|\n`;
md += `| ⭐≥12 | ${mined.filter(m=>m.weight>=12).length} |\n`;
md += `| ⭐≥10 | ${mined.filter(m=>m.weight>=10).length} |\n`;
md += `| ⭐≥9 | ${mined.filter(m=>m.weight>=9).length} |\n`;
md += `| ⭐≥8 | ${mined.filter(m=>m.weight>=8).length} |\n`;
md += `| ⭐5-7 | ${mined.filter(m=>m.weight>=5&&m.weight<=7).length} |\n`;
md += `| ⭐<5 | ${mined.filter(m=>m.weight<5).length} |\n\n`;

md += `## 候选单元类型分布\n\n`;
const typeDist = {};
for (const m of mined) {
  const t = m.unitType || '待定';
  typeDist[t] = (typeDist[t] || 0) + 1;
}
md += `| 类型 | 数量 |\n`;
md += `|------|------|\n`;
for (const [t, c] of Object.entries(typeDist).sort((a,b) => b[1]-a[1])) {
  md += `| ${t} | ${c} |\n`;
}

md += `\n---\n\n`;
md += `## 高优先级挖掘 (⭐≥10)\n\n`;

for (const m of mined.filter(m => m.weight >= 10)) {
  md += `### ${m.id} ⭐${m.weight} | ${m.lock} | ${m.route} | →${m.unitType || '待定'}\n\n`;
  md += `- **核心句式**: ${m.keySentence || '(无)'}\n`;
  md += `- **被动模式**: ${m.passive || '(无)'}\n`;
  md += `- **缺失诊断**: ${m.missing || '(无)'}\n`;
  md += `- **框架**: ${m.framework || '(无)'}\n`;
  md += `- **标签**: ${m.tags.join(', ')}\n`;
  md += `- **自知**: ${m.spectrum}\n\n`;
}

md += `---\n\n`;
md += `## 中优先级挖掘 (⭐8-9)\n\n`;

for (const m of mined.filter(m => m.weight >= 8 && m.weight <= 9)) {
  md += `### ${m.id} ⭐${m.weight} | ${m.lock} | ${m.route} | →${m.unitType || '待定'}\n\n`;
  md += `- **核心句式**: ${m.keySentence || '(无)'}\n`;
  md += `- **被动模式**: ${m.passive || '(无)'}\n`;
  md += `- **缺失诊断**: ${m.missing || '(无)'}\n`;
  md += `- **标签**: ${m.tags.join(', ')}\n\n`;
}

// Write the ledger
fs.writeFileSync(OUTPUT, md, 'utf-8');
console.log(`挖掘台账已生成: ${OUTPUT}`);
console.log(`总未引用LD: ${mined.length}`);
console.log(`高优先级(≥10): ${mined.filter(m=>m.weight>=10).length}`);
console.log(`中优先级(8-9): ${mined.filter(m=>m.weight>=8 && m.weight<=9).length}`);
console.log(`OPI候选: ${mined.filter(m=>m.unitType==='OPI').length}`);
console.log(`CON候选: ${mined.filter(m=>m.unitType==='CON').length}`);
console.log(`CAS候选: ${mined.filter(m=>m.unitType==='CAS').length}`);

// Also output a JSON for programmatic use
const jsonOutput = path.join(BASE, '03-处理状态', 'LD挖掘数据.json');
fs.writeFileSync(jsonOutput, JSON.stringify(mined, null, 2), 'utf-8');
console.log(`JSON数据已生成: ${jsonOutput}`);

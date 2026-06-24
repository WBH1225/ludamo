// connect-remaining.js — 处理325个"全无连接"文件的脚本
// 包括：01-原始素材区LD文件、规则、模板、主题地图、skills等
// 模式: node connect-remaining.js [--apply]

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';

// ============ Frontmatter 解析（简化版） ============
function quickParse(content) {
  const fm = { id: '', title: '', themes: [], keywords: [], source_documents: [], relationships: [] };
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fm;
  const raw = match[1];

  ['id', 'title'].forEach(f => {
    const m = raw.match(new RegExp(`^${f}:\\s*(.+)$`, 'm'));
    if (m) fm[f] = m[1].trim();
  });

  // List fields
  ['themes', 'keywords', 'source_documents'].forEach(field => {
    fm[field] = parseList(raw, field);
  });

  // Relationships
  fm.relationships = parseRels(raw);

  return fm;
}

function parseList(raw, fieldName) {
  const items = [];
  const lines = raw.split('\n');
  let inField = false;
  for (const line of lines) {
    if (inField) {
      const m = line.match(/^\s{2}- (.+)/);
      if (m) { items.push(m[1].trim()); continue; }
      if (line.trim() === '') continue;
      if (/^\w+:/.test(line)) break;
    }
    if (line.trim() === `${fieldName}:`) inField = true;
  }
  return items;
}

function parseRels(raw) {
  const rels = [];
  if (raw.includes('relationships: []')) return rels;
  const lines = raw.split('\n');
  let inRels = false, current = null;
  for (const line of lines) {
    if (!inRels && line.trim() === 'relationships:') { inRels = true; continue; }
    if (!inRels) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('- type:')) {
      if (current && current.target) rels.push(current);
      current = { type: trimmed.slice('- type:'.length).trim(), target: '', note: '' };
      continue;
    }
    if (trimmed !== '' && !line.startsWith('  ') && !line.startsWith('\t')) {
      if (current && current.target) rels.push(current);
      break;
    }
    if (!current) continue;
    if (trimmed.startsWith('target:')) current.target = trimmed.slice('target:'.length).trim();
    if (trimmed.startsWith('note:')) current.note = trimmed.slice('note:'.length).trim();
  }
  if (current && current.target) rels.push(current);
  return rels;
}

// ============ 构建索引 ============
function buildIndexes() {
  const unitIndex = {}; // unitId → { fileName, title, type, themes, keywords }
  const bySourceDoc = {}; // SRC-LD-XXX → [unitId, ...]

  const unitDir = path.join(BASE, '02-内容单元库');
  for (const typeDir of fs.readdirSync(unitDir)) {
    const fullDir = path.join(unitDir, typeDir);
    if (!fs.statSync(fullDir).isDirectory()) continue;
    for (const file of fs.readdirSync(fullDir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(fullDir, file), 'utf-8');
      const fm = quickParse(content);
      if (!fm.id) continue;

      unitIndex[fm.id] = {
        fileName: file.replace('.md', ''),
        title: fm.title || '',
        type: typeDir,
        themes: fm.themes || [],
        keywords: fm.keywords || [],
      };

      for (const src of (fm.source_documents || [])) {
        if (!bySourceDoc[src]) bySourceDoc[src] = [];
        bySourceDoc[src].push(fm.id);
      }
    }
  }

  return { unitIndex, bySourceDoc };
}

// ============ 添加wiki链接到文件 ============
function addWikiLinksToFile(filePath, links, sectionName) {
  let content = fs.readFileSync(filePath, 'utf-8');

  // 去重
  const existingLinks = new Set();
  const matches = content.match(/\[\[([^\]]+)\]\]/g);
  if (matches) matches.forEach(m => existingLinks.add(m));

  const newLinks = links.filter(l => !existingLinks.has(l));
  if (newLinks.length === 0) return 0;

  if (MODE !== 'apply') return newLinks.length;

  const sectionHeader = `## ${sectionName}`;
  const existingSection = content.includes(sectionHeader);

  if (existingSection) {
    const idx = content.indexOf(sectionHeader);
    const nextSection = content.indexOf('\n## ', idx + 1);
    if (nextSection > 0) {
      content = content.substring(0, nextSection) + '\n' + newLinks.join('\n') + '\n' + content.substring(nextSection);
    } else {
      content = content.trimEnd() + '\n' + newLinks.join('\n') + '\n';
    }
  } else {
    content = content.trimEnd() + '\n\n' + sectionHeader + '\n\n' + newLinks.join('\n') + '\n';
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return newLinks.length;
}

// ============ 主流程 ============
function main() {
  console.log('🔧 处理剩余未连接文件');
  console.log(`模式: ${MODE.toUpperCase()}`);
  console.log('='.repeat(60));

  const { unitIndex, bySourceDoc } = buildIndexes();
  console.log(`📊 索引: ${Object.keys(unitIndex).length} 个内容单元, ${Object.keys(bySourceDoc).length} 个有衍生单元的来源`);

  let totalProcessed = 0;
  let totalLinksAdded = 0;

  // ============ 阶段1: 01-原始素材区 LD文件 → 衍生内容单元 ============
  console.log(`\n--- 阶段1: LD文件 → 衍生内容单元 ---`);
  const sourceDir = path.join(BASE, '01-原始素材区', '完整副本', '对话');
  let ldCount = 0;

  if (fs.existsSync(sourceDir)) {
    for (const file of fs.readdirSync(sourceDir)) {
      if (!file.endsWith('.md')) continue;
      const srcMatch = file.match(/^(LD-\d+)/);
      if (!srcMatch) continue;
      const ldId = srcMatch[1];
      const srcRef = 'SRC-' + ldId;

      const derivedUnits = bySourceDoc[srcRef] || [];
      if (derivedUnits.length === 0) {
        // 即使没有衍生单元，也添加相邻LD文件的链接
        const ldNum = parseInt(ldId.replace('LD-', ''));
        const neighbors = [];
        if (ldNum > 1) neighbors.push(`[[LD-${String(ldNum-1).padStart(3,'0')}]]`);
        if (ldNum < 904) neighbors.push(`[[LD-${String(ldNum+1).padStart(3,'0')}]]`);
        if (neighbors.length > 0) {
          const n = addWikiLinksToFile(path.join(sourceDir, file), neighbors, '关联对话');
          if (n > 0) { ldCount++; totalLinksAdded += n; }
        }
        continue;
      }

      const links = derivedUnits.map(uid => {
        const info = unitIndex[uid];
        return info ? `[[${info.fileName}]]` : null;
      }).filter(Boolean);

      // 也添加邻居LD链接
      const ldNum = parseInt(ldId.replace('LD-', ''));
      if (ldNum > 1) links.push(`[[LD-${String(ldNum-1).padStart(3,'0')}]]`);
      if (ldNum < 904) links.push(`[[LD-${String(ldNum+1).padStart(3,'0')}]]`);

      const n = addWikiLinksToFile(path.join(sourceDir, file), links, '关联单元');
      if (n > 0) { ldCount++; totalLinksAdded += n; }
    }
  }
  console.log(`  LD文件: ${ldCount} 个添加了 ${totalLinksAdded} 个链接`);

  // ============ 阶段2: 规则/模板/主题/状态文件 ============
  console.log(`\n--- 阶段2: 规则/模板/主题/状态文件 ---`);

  const configDirs = ['00-规则与索引', '03-处理状态', '04-模板', '05-主题地图'];
  let configCount = 0;
  let configLinks = 0;

  for (const dirName of configDirs) {
    const dir = path.join(BASE, dirName);
    if (!fs.existsSync(dir)) continue;

    const filesInDir = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    const allFileNames = filesInDir.map(f => f.replace('.md', ''));

    for (const file of filesInDir) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('[[')) continue; // 已有wiki链接

      const links = [];

      // 1. 同目录文件互链
      for (const otherName of allFileNames) {
        if (otherName !== file.replace('.md', '')) {
          links.push(`[[${otherName}]]`);
        }
      }

      // 2. 根据目录类型添加特定链接
      if (dirName === '00-规则与索引') {
        links.push('[[内容单元字段规范]]');
        links.push('[[内容单元关系规则]]');
        links.push('[[处理流程]]');
        links.push('[[新增文稿进入系统流程]]');
        links.push('[[来源命名规范]]');
      } else if (dirName === '03-处理状态') {
        links.push('[[处理流程]]');
        links.push('[[内容单元关系规则]]');
        links.push('[[抽取日志]]');
        links.push('[[LD挖掘台账]]');
      } else if (dirName === '04-模板') {
        // 模板 → 对应规则
        links.push('[[内容单元字段规范]]');
        links.push('[[内容单元关系规则]]');
        // 模板 → 同类型示例
        const typeMatch = file.match(/(\S+)单元模板/);
        if (typeMatch) {
          const typeName = typeMatch[1]; // 问题、观点、概念、案例、方案
          const typeMap = { '问题': 'QST', '观点': 'OPI', '概念': 'CON', '案例': 'CAS', '方案': 'SOL' };
          const typeCode = typeMap[typeName];
          if (typeCode) {
            // 链接到该类型的第一个单元作为示例
            for (const [uid, info] of Object.entries(unitIndex)) {
              if (uid.startsWith(typeCode)) {
                links.push(`[[${info.fileName}]]`);
                break;
              }
            }
          }
        }
      } else if (dirName === '05-主题地图') {
        // 主题地图 → 覆盖的单元类型
        links.push('[[内容单元关系规则]]');
        links.push('[[内容单元字段规范]]');
        links.push('[[处理流程]]');
        // 链接到一些关键概念
        for (const conId of ['CON-005', 'CON-006', 'CON-016']) {
          if (unitIndex[conId]) links.push(`[[${unitIndex[conId].fileName}]]`);
        }
      }

      // 去重 + 限制数量
      const uniqueLinks = [...new Set(links)].slice(0, 12);

      const n = addWikiLinksToFile(filePath, uniqueLinks, '关联文件');
      if (n > 0) { configCount++; configLinks += n; }
    }
  }
  console.log(`  配置文件: ${configCount} 个添加了 ${configLinks} 个链接`);

  // ============ 阶段3: 鲁大魔skills ============
  console.log(`\n--- 阶段3: 鲁大魔skills ---`);
  const skillsDir = path.join(BASE, '鲁大魔skills');
  let skillsCount = 0;
  let skillsLinks = 0;

  if (fs.existsSync(skillsDir)) {
    // 收集所有skills文件名
    const skillDirs = [];
    const skillFiles = [];
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        skillDirs.push(entry.name);
        // 收集子目录中的文件
        const subDir = path.join(skillsDir, entry.name);
        for (const f of fs.readdirSync(subDir)) {
          if (f.endsWith('.md')) skillFiles.push({ name: f.replace('.md', ''), dir: entry.name });
        }
      } else if (entry.name.endsWith('.md')) {
        skillFiles.push({ name: entry.name.replace('.md', ''), dir: '' });
      }
    }

    // 处理所有skill文件
    function processSkillDir(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { processSkillDir(full); continue; }
        if (!entry.name.endsWith('.md')) continue;

        const content = fs.readFileSync(full, 'utf-8');
        if (content.includes('[[')) continue;

        const links = [];
        // 链接到其他skill文件
        for (const sf of skillFiles) {
          if (sf.name !== entry.name.replace('.md', '')) {
            links.push(`[[${sf.name}]]`);
          }
        }
        // 链接到规则
        links.push('[[内容单元关系规则]]');
        links.push('[[内容单元字段规范]]');
        links.push('[[处理流程]]');

        // 链接到关键概念
        for (const conId of ['CON-005', 'CON-006', 'CON-013', 'CON-016']) {
          if (unitIndex[conId]) links.push(`[[${unitIndex[conId].fileName}]]`);
        }

        const uniqueLinks = [...new Set(links)].slice(0, 15);
        const n = addWikiLinksToFile(full, uniqueLinks, '关联文件');
        if (n > 0) { skillsCount++; skillsLinks += n; }
      }
    }
    processSkillDir(skillsDir);
  }
  console.log(`  Skills: ${skillsCount} 个添加了 ${skillsLinks} 个链接`);

  // ============ 阶段4: README和SOURCE_OF_TRUTH ============
  console.log(`\n--- 阶段4: 根文件 ---`);
  let rootCount = 0;
  let rootLinks = 0;

  for (const rootFile of ['README.md', 'SOURCE_OF_TRUTH.md']) {
    const fp = path.join(BASE, rootFile);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, 'utf-8');
    if (content.includes('[[')) continue;

    const links = [
      '[[处理流程]]', '[[内容单元关系规则]]', '[[内容单元字段规范]]',
      '[[来源命名规范]]', '[[新增文稿进入系统流程]]',
    ];
    for (const conId of ['CON-005', 'CON-006', 'CON-016']) {
      if (unitIndex[conId]) links.push(`[[${unitIndex[conId].fileName}]]`);
    }
    const n = addWikiLinksToFile(fp, links, '关联文件');
    if (n > 0) { rootCount++; rootLinks += n; }
  }
  console.log(`  根文件: ${rootCount} 个添加了 ${rootLinks} 个链接`);

  // ============ 最终报告 ============
  const grandTotal = ldCount + configCount + skillsCount + rootCount;
  const grandLinks = totalLinksAdded + configLinks + skillsLinks + rootLinks;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 ${MODE === 'apply' ? '执行' : '预览'}完成`);
  console.log(`  阶段1 (LD文件): ${ldCount} 文件`);
  console.log(`  阶段2 (配置): ${configCount} 文件`);
  console.log(`  阶段3 (Skills): ${skillsCount} 文件`);
  console.log(`  阶段4 (根文件): ${rootCount} 文件`);
  console.log(`  总计: ${grandTotal} 个文件将添加连接`);

  if (MODE === 'dry-run') {
    console.log(`\n💡 确认无误后运行: node 07-脚本与工具/connect-remaining.js --apply`);
  }
}

main();

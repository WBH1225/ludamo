// fill-wiki-links.js — 为已有YAML relationships的单元生成 [[wiki links]]
// 也会为01-原始素材区文件和规则文件添加适当的连接
// 模式: node fill-wiki-links.js [--apply]

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';

// ============ 解析YAML frontmatter ============
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { raw: '', body: content, themes: [], keywords: [], relationships: [], source_documents: [], id: '' };
  const raw = match[1];
  const body = content.substring(match[0].length);

  const fm = { raw, body, themes: [], keywords: [], relationships: [], source_documents: [], id: '' };

  // Scalar fields
  ['id', 'type', 'title'].forEach(f => {
    const re = new RegExp(`^${f}:\\s*(.+)$`, 'm');
    const m = raw.match(re);
    if (m) fm[f] = m[1].trim();
  });

  // List fields
  ['themes', 'keywords', 'source_documents'].forEach(field => {
    fm[field] = parseListField(raw, field);
  });

  // Relationships
  fm.relationships = parseRelationships(raw);

  return fm;
}

function parseListField(raw, fieldName) {
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

function parseRelationships(raw) {
  const rels = [];
  const lines = raw.split('\n');
  let inRels = false;
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === 'relationships: []' || line.trim() === '[]') return [];

    if (!inRels && line.trim() === 'relationships:') {
      inRels = true;
      continue;
    }

    if (!inRels) continue;

    const trimmed = line.trim();

    if (trimmed.startsWith('- type:')) {
      if (current && current.target) rels.push(current);
      current = { type: trimmed.slice('- type:'.length).trim(), target: '', note: '' };
      continue;
    }

    // End of relationships
    if (trimmed !== '' && !line.startsWith('  ') && !line.startsWith('\t')) {
      if (current && current.target) rels.push(current);
      inRels = false;
      continue;
    }

    if (!current) continue;
    if (trimmed.startsWith('target:')) current.target = trimmed.slice('target:'.length).trim();
    if (trimmed.startsWith('note:')) current.note = trimmed.slice('note:'.length).trim();
  }
  if (current && current.target) rels.push(current);

  return rels;
}

// ============ 构建文件名索引 ============
function buildFileNameIndex() {
  const index = {}; // unitId → { fileName, filePath, title }
  const bySourceDoc = {}; // sourceDocId → [unitId, ...]

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.md')) continue;

      const content = fs.readFileSync(full, 'utf-8');
      const fm = parseFrontmatter(content);

      if (fm.id) {
        index[fm.id] = {
          fileName: entry.name.replace('.md', ''),
          filePath: full,
          title: fm.title || '',
          type: fm.type || '',
          source_documents: fm.source_documents || [],
        };
      }

      // 按source_documents索引
      for (const src of (fm.source_documents || [])) {
        if (!bySourceDoc[src]) bySourceDoc[src] = [];
        bySourceDoc[src].push(fm.id);
      }
    }
  }

  walk(path.join(BASE, '02-内容单元库'));
  return { index, bySourceDoc };
}

// ============ 生成wiki链接 ============
function generateWikiLinks(relTargets, fileNameIndex) {
  const links = [];
  const seen = new Set();

  for (const targetId of relTargets) {
    if (seen.has(targetId)) continue;
    seen.add(targetId);

    const info = fileNameIndex[targetId];
    if (!info) {
      console.log(`    ⚠️ 找不到目标文件: ${targetId}`);
      continue;
    }
    links.push(`[[${info.fileName}]]`);
  }

  return links;
}

// ============ 主流程 ============
function main() {
  console.log('🔧 填充Wiki链接脚本');
  console.log(`模式: ${MODE.toUpperCase()}`);
  console.log('='.repeat(60));

  const { index: fileNameIndex, bySourceDoc } = buildFileNameIndex();
  console.log(`📊 索引了 ${Object.keys(fileNameIndex).length} 个内容单元`);

  // ============ 阶段1: 02-内容单元库 — 从YAML关系生成wiki链接 ============
  console.log(`\n--- 阶段1: 内容单元库 YAML → Wiki ---`);

  const unitDirs = [
    path.join(BASE, '02-内容单元库', 'CAS'),
    path.join(BASE, '02-内容单元库', 'CON'),
    path.join(BASE, '02-内容单元库', 'OPI'),
    path.join(BASE, '02-内容单元库', 'QST'),
    path.join(BASE, '02-内容单元库', 'SOL'),
  ];

  let phase1Total = 0;
  let phase1Edited = 0;

  for (const dir of unitDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      phase1Total++;
      const filePath = path.join(dir, file);
      let content = fs.readFileSync(filePath, 'utf-8');
      const fm = parseFrontmatter(content);

      // 提取YAML关系中的所有target
      const relTargets = (fm.relationships || []).map(r => r.target).filter(Boolean);

      if (relTargets.length === 0) continue;

      // 检查已有的wiki链接
      const existingWikiLinks = new Set();
      const wikiMatches = content.match(/\[\[([^\]]+)\]\]/g);
      if (wikiMatches) {
        for (const m of wikiMatches) existingWikiLinks.add(m);
      }

      // 生成需要的wiki链接
      const newLinks = generateWikiLinks(relTargets, fileNameIndex)
        .filter(l => !existingWikiLinks.has(l));

      if (newLinks.length === 0) continue;

      phase1Edited++;

      if (MODE === 'apply') {
        // 找到或创建 ## 关联单元 section
        const relatedSection = content.match(/## 关联单元/);
        if (relatedSection) {
          // 追加到现有section
          const sectionIdx = content.indexOf('## 关联单元');
          // 找到下一个 ## section
          const nextSection = content.indexOf('\n## ', sectionIdx + 1);
          if (nextSection > 0) {
            content = content.substring(0, nextSection) + '\n' + newLinks.join('\n') + '\n' + content.substring(nextSection);
          } else {
            content = content.trimEnd() + '\n' + newLinks.join('\n') + '\n';
          }
        } else {
          content = content.trimEnd() + '\n\n## 关联单元\n\n' + newLinks.join('\n') + '\n';
        }
        fs.writeFileSync(filePath, content, 'utf-8');
      }

      console.log(`  ✅ ${fm.id}: +${newLinks.length} wiki links → ${relTargets.slice(0,3).join(', ')}${relTargets.length > 3 ? '...' : ''}`);
    }
  }

  console.log(`  阶段1: ${phase1Edited}/${phase1Total} 个文件需要补充wiki链接`);

  // ============ 阶段2: 01-原始素材区 未连接文件 → 链接到其衍生的内容单元 ============
  console.log(`\n--- 阶段2: 原始素材区 反向链接 ---`);

  const sourceDir = path.join(BASE, '01-原始素材区', '完整副本');
  let phase2Total = 0;
  let phase2Edited = 0;

  function walkSource(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walkSource(full); continue; }
      if (!entry.name.endsWith('.md')) continue;
      phase2Total++;

      // 从文件名推断来源ID
      const srcIdMatch = entry.name.match(/^(LD-\d+)/);
      if (!srcIdMatch) return;
      const srcId = srcIdMatch[1];
      const fullSrcId = 'SRC-' + srcId;

      // 找到引用该来源的内容单元
      const derivedUnits = bySourceDoc[fullSrcId] || [];

      if (derivedUnits.length === 0) return;

      let content = fs.readFileSync(full, 'utf-8');

      // 检查已有wiki链接
      const existingWikiLinks = new Set();
      const wikiMatches = content.match(/\[\[([^\]]+)\]\]/g);
      if (wikiMatches) {
        for (const m of wikiMatches) existingWikiLinks.add(m);
      }

      const newLinks = [];
      for (const unitId of derivedUnits) {
        const info = fileNameIndex[unitId];
        if (!info) continue;
        const link = `[[${info.fileName}]]`;
        if (!existingWikiLinks.has(link)) newLinks.push(link);
      }

      if (newLinks.length === 0) return;
      phase2Edited++;

      if (MODE === 'apply') {
        const relatedSection = content.match(/## 关联内容单元/);
        if (relatedSection) {
          const sectionIdx = content.indexOf('## 关联内容单元');
          const nextSection = content.indexOf('\n## ', sectionIdx + 1);
          if (nextSection > 0) {
            content = content.substring(0, nextSection) + '\n' + newLinks.join('\n') + '\n' + content.substring(nextSection);
          } else {
            content = content.trimEnd() + '\n' + newLinks.join('\n') + '\n';
          }
        } else if (content.includes('## 关联单元')) {
          const sectionIdx = content.indexOf('## 关联单元');
          const nextSection = content.indexOf('\n## ', sectionIdx + 1);
          if (nextSection > 0) {
            content = content.substring(0, nextSection) + '\n' + newLinks.join('\n') + '\n' + content.substring(nextSection);
          } else {
            content = content.trimEnd() + '\n' + newLinks.join('\n') + '\n';
          }
        } else {
          content = content.trimEnd() + '\n\n## 关联单元\n\n' + newLinks.join('\n') + '\n';
        }
        fs.writeFileSync(full, content, 'utf-8');
      }

      console.log(`  ✅ ${srcId}: +${newLinks.length} wiki links → ${derivedUnits.join(', ')}`);
    }
  }

  walkSource(sourceDir);
  console.log(`  阶段2: ${phase2Edited}/${phase2Total} 个LD文件需要补充wiki链接`);

  // ============ 阶段3: 小目录规则文件 ============
  console.log(`\n--- 阶段3: 规则/模板/主题目录 ---`);

  const otherDirs = [
    '00-规则与索引',
    '03-处理状态',
    '04-模板',
    '05-主题地图',
  ];

  let phase3Total = 0;
  let phase3Edited = 0;

  for (const dirName of otherDirs) {
    const dir = path.join(BASE, dirName);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      phase3Total++;
      const filePath = path.join(dir, file);
      let content = fs.readFileSync(filePath, 'utf-8');

      // 找该文件在内容单元中的引用
      const refs = [];
      for (const [unitId, info] of Object.entries(fileNameIndex)) {
        // 检查是否引用了相关主题
        const unitContent = fs.readFileSync(info.filePath + '.md', 'utf-8').catch(() => '');
        // 简化：基于文件名关键词匹配
        const fileNameWithoutExt = file.replace('.md', '');
        const keyTerms = fileNameWithoutExt.replace(/[——\-_、，。]/g, ' ').split(/\s+/);

        // 不在此做深度匹配，规则文件用手动连接
      }

      // 检查是否已有wiki链接
      const hasWiki = content.includes('[[');
      if (hasWiki) continue;

      // 规则文件之间的互相连接（基于内容）
      const allRules = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== file);
      const newLinks = [];

      // 添加同目录的其他规则文件链接
      for (const otherFile of allRules.slice(0, 5)) {
        const otherName = otherFile.replace('.md', '');
        newLinks.push(`[[${otherName}]]`);
      }

      // 对于规则文件，也链接到源文件和总览文件
      if (dirName === '00-规则与索引') {
        newLinks.push('[[处理流程]]');
        newLinks.push('[[内容单元关系规则]]');
        newLinks.push('[[内容单元字段规范]]');
      }

      if (newLinks.length === 0) continue;
      phase3Edited++;

      if (MODE === 'apply') {
        content = content.trimEnd() + '\n\n## 关联文件\n\n' + [...new Set(newLinks)].join('\n') + '\n';
        fs.writeFileSync(filePath, content, 'utf-8');
      }
      console.log(`  ✅ ${file}: +${newLinks.length} wiki links`);
    }
  }
  console.log(`  阶段3: ${phase3Edited}/${phase3Total} 个规则文件需要补充wiki链接`);

  // ============ 最终报告 ============
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 ${MODE === 'apply' ? '执行' : '预览'}完成`);
  console.log(`  阶段1 (内容单元): ${phase1Edited} 个文件`);
  console.log(`  阶段2 (原始素材): ${phase2Edited} 个文件`);
  console.log(`  阶段3 (规则模板): ${phase3Edited} 个文件`);
  console.log(`  总计将添加链接: ${phase1Edited + phase2Edited + phase3Edited} 个文件`);

  if (MODE === 'dry-run') {
    console.log(`\n💡 确认无误后运行: node 07-脚本与工具/fill-wiki-links.js --apply`);
  }
}

main();

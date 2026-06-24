// auto-connect-all.js — 全库智能连接脚本
// 基于主题/关键词交叉匹配，自动为未连接的内容单元添加关系
// 支持 dry-run 和 apply 两种模式

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const TYPES = ['QST', 'OPI', 'CON', 'CAS', 'SOL'];
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';

// ============ 配置 ============
const CONFIG = {
  minThemeOverlap: 1,           // 最少共享主题数
  minKeywordOverlap: 2,         // 最少共享关键词数
  maxRelationshipsPerUnit: 6,   // 每个单元最多添加的关系数
  maxWikiLinksPerUnit: 8,       // 每个单元最多添加的wiki链接数
  scoreThreshold: 0.15,         // 最低匹配分数
};

// ============ YAML解析 ============
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { raw: '', body: content };
  const raw = match[1];
  const body = content.substring(match[0].length);

  const fm = { raw, body, themes: [], keywords: [], relationships: [] };

  // Parse scalar fields
  const scalarFields = ['id', 'type', 'title', 'status', 'canonical', 'version',
    'created_at', 'updated_at', 'core_claim', 'claim_scope', 'why_it_matters',
    'case_question', 'case_surface_bottleneck', 'case_real_bottleneck',
    'concept_definition', 'concept_function', 'question_text', 'question_type',
    'user_stage', 'target_problem', 'solution_summary', 'action_steps', 'expected_result'];

  for (const field of scalarFields) {
    const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
    const m = raw.match(re);
    if (m) fm[field] = m[1].trim();
  }

  // Parse list fields (themes, keywords, source_documents, source_authors)
  const listFields = ['themes', 'keywords', 'source_documents', 'source_authors'];
  for (const field of listFields) {
    fm[field] = parseListField(raw, field);
  }

  // Parse relationships
  fm.relationships = parseRelationships(raw);

  return fm;
}

function parseListField(raw, fieldName) {
  const items = [];
  const lines = raw.split('\n');
  let inField = false;
  for (const line of lines) {
    if (inField) {
      const itemMatch = line.match(/^\s{2}- (.+)/);
      if (itemMatch) {
        items.push(itemMatch[1].trim());
        continue;
      }
      // Empty line within list = keep going
      if (line.trim() === '') continue;
      // Next field starts
      if (/^\w+:/.test(line)) break;
    }
    if (line.trim() === `${fieldName}:`) {
      inField = true;
      continue;
    }
  }
  return items;
}

function parseRelationships(raw) {
  const rels = [];
  const lines = raw.split('\n');
  let inRels = false;
  let current = null;

  for (const line of lines) {
    if (!inRels) {
      if (line.trim() === 'relationships:') {
        inRels = true;
        // Check if next line is "  - type: ..." vs "relationships: []"
      }
      continue;
    }

    // Empty relationships list
    if (line.trim() === 'relationships: []' || line.trim() === '[]') {
      return [];
    }

    const trimmed = line.trim();

    // New relationship entry
    if (trimmed.startsWith('- type:')) {
      if (current && current.target) rels.push(current);
      current = { type: trimmed.slice('- type:'.length).trim(), target: '', note: '' };
      continue;
    }

    // End of relationships block
    if (!line.startsWith('  ') && !line.startsWith('\t') && trimmed !== '') {
      if (current && current.target) rels.push(current);
      inRels = false;
      current = null;
      continue;
    }

    if (!current) continue;
    if (trimmed.startsWith('target:')) current.target = trimmed.slice('target:'.length).trim();
    if (trimmed.startsWith('note:')) current.note = trimmed.slice('note:'.length).trim();
  }
  if (current && current.target) rels.push(current);

  return rels;
}

// ============ 匹配计算 ============
function jaccardSimilarity(setA, setB) {
  if (setA.length === 0 || setB.length === 0) return 0;
  const a = new Set(setA);
  const b = new Set(setB);
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeMatchScore(unitA, unitB) {
  // Theme overlap (weight: 3)
  const themeSim = jaccardSimilarity(unitA.themes || [], unitB.themes || []);
  // Keyword overlap (weight: 2)
  const kwSim = jaccardSimilarity(unitA.keywords || [], unitB.keywords || []);
  // Title keyword overlap (weight: 1)
  const titleAWords = new Set((unitA.title || '').replace(/[——，。、！？：；、\s]/g, '').split(''));
  const titleBWords = new Set((unitB.title || '').replace(/[——，。、！？：；、\s]/g, '').split(''));
  let titleOverlap = 0;
  for (const w of titleAWords) {
    if (titleBWords.has(w)) titleOverlap++;
  }
  const titleSim = (titleAWords.size + titleBWords.size) === 0 ? 0 :
    titleOverlap / Math.max(titleAWords.size, titleBWords.size);

  return themeSim * 3 + kwSim * 2 + titleSim * 1;
}

// ============ 关系类型决策 ============
function determineRelationType(sourceType, targetType, sourceThemes, targetThemes) {
  // sourceType 和 targetType 是类型名称如 'CAS', 'OPI', 'CON', 'QST', 'SOL'

  const typeMap = {
    'CAS': '案例单元',
    'OPI': '观点单元',
    'CON': '概念单元',
    'QST': '问题单元',
    'SOL': '方案单元'
  };

  const sType = typeMap[sourceType] || sourceType;
  const tType = typeMap[targetType] || targetType;

  // 案例 → 观点/概念：证明
  if (sourceType === 'CAS' && (targetType === 'OPI' || targetType === 'CON')) {
    return '证明';
  }
  // 案例 → 问题：回应
  if (sourceType === 'CAS' && targetType === 'QST') {
    return '回应';
  }
  // 观点 → 概念：证明 或 解释
  if (sourceType === 'OPI' && targetType === 'CON') {
    return '证明';
  }
  // 观点 → 案例：证明（反向引用）
  if (sourceType === 'OPI' && targetType === 'CAS') {
    return '证明';
  }
  // 观点 ↔ 观点：回应
  if (sourceType === 'OPI' && targetType === 'OPI') {
    return '回应';
  }
  // 观点 → 问题：回应
  if (sourceType === 'OPI' && targetType === 'QST') {
    return '回应';
  }
  // 方案 → 问题：解决（不在四类中但实际使用）
  if (sourceType === 'SOL' && targetType === 'QST') {
    return '解决';
  }
  // 概念 → 观点/案例：解释
  if (sourceType === 'CON' && (targetType === 'OPI' || targetType === 'CAS')) {
    return '解释';
  }
  // 问题 → 观点/方案：回应
  if (sourceType === 'QST' && (targetType === 'OPI' || targetType === 'SOL')) {
    return '回应';
  }

  // 默认：同主题用回应
  return '回应';
}

function generateNote(sourceUnit, targetUnit, relType) {
  const sharedThemes = (sourceUnit.themes || []).filter(t => (targetUnit.themes || []).includes(t));
  const themeStr = sharedThemes.slice(0, 2).join('+');

  if (relType === '证明') {
    return `${sourceUnit.id}是${targetUnit.id}(${targetUnit.title?.substring(0,15)}...)的案例证明——共享主题：${themeStr}`;
  }
  if (relType === '解释') {
    return `${sourceUnit.id}解释了${targetUnit.id}的底层原理——共享主题：${themeStr}`;
  }
  if (relType === '回应') {
    return `${sourceUnit.id}回应了${targetUnit.id}的相关判断——共享主题：${themeStr}`;
  }
  if (relType === '解决') {
    return `${sourceUnit.id}提供了${targetUnit.id}的解决方案——共享主题：${themeStr}`;
  }
  return `共享主题：${themeStr}`;
}

// ============ Wiki链接生成 ============
function generateWikiLink(unitId, unitTitle, unitType) {
  const files = allFiles[unitId];
  if (!files || !files.fileName) return null;
  // Obsidian wiki link format: [[filename|display]]
  const name = files.fileName.replace('.md', '');
  return `[[${name}]]`;
}

// ============ 文件系统操作 ============
const allUnits = {};   // id → parsed frontmatter
const allFiles = {};   // id → {filePath, fileName}
const themeIndex = {}; // theme → [unitId, ...]
const keywordIndex = {}; // keyword → [unitId, ...]

function loadAllUnits() {
  for (const type of TYPES) {
    const dir = path.join(UNIT_DIR, type);
    if (!fs.existsSync(dir)) {
      console.log(`  ⚠️ 目录不存在: ${dir}`);
      continue;
    }
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const fm = parseFrontmatter(content);
      if (!fm.id) {
        console.log(`  ⚠️ 无ID: ${file}`);
        continue;
      }
      fm._filePath = filePath;
      fm._fileName = file;
      fm._typeCode = type;
      allUnits[fm.id] = fm;
      allFiles[fm.id] = { filePath, fileName: file, typeCode: type };

      // 建立索引
      for (const theme of (fm.themes || [])) {
        if (!themeIndex[theme]) themeIndex[theme] = [];
        themeIndex[theme].push(fm.id);
      }
      for (const kw of (fm.keywords || [])) {
        if (!keywordIndex[kw]) keywordIndex[kw] = [];
        keywordIndex[kw].push(fm.id);
      }
    }
  }
  console.log(`\n📊 已加载 ${Object.keys(allUnits).length} 个内容单元`);
  console.log(`  主题索引: ${Object.keys(themeIndex).length} 个独特主题`);
  console.log(`  关键词索引: ${Object.keys(keywordIndex).length} 个独特关键词`);
}

function getExistingTargets(unit) {
  // 返回该单元已有关系的所有target ID
  const targets = new Set();
  for (const rel of (unit.relationships || [])) {
    if (rel.target) targets.add(rel.target);
  }
  // Also check wiki links in body
  const wikiMatches = (unit.body || '').match(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g);
  if (wikiMatches) {
    for (const m of wikiMatches) {
      const idMatch = m.match(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/);
      if (idMatch) {
        const ref = idMatch[1];
        // Extract unit ID from filename pattern like "OPI-001_..."
        const idFromFile = ref.match(/^([A-Z]+-\d+)/);
        if (idFromFile) targets.add(idFromFile[1]);
      }
    }
  }
  return targets;
}

function findBestMatches(unitId, maxResults = 15) {
  const unit = allUnits[unitId];
  if (!unit) return [];

  const unitThemes = new Set(unit.themes || []);
  const unitKeywords = new Set(unit.keywords || []);
  const existingTargets = getExistingTargets(unit);

  // 通过主题索引收集候选
  const candidates = new Map(); // candidateId → overlapCount

  for (const theme of (unit.themes || [])) {
    const linked = themeIndex[theme] || [];
    for (const candidateId of linked) {
      if (candidateId === unitId) continue;
      if (existingTargets.has(candidateId)) continue;
      candidates.set(candidateId, (candidates.get(candidateId) || 0) + 3);
    }
  }

  for (const kw of (unit.keywords || [])) {
    const linked = keywordIndex[kw] || [];
    for (const candidateId of linked) {
      if (candidateId === unitId) continue;
      if (existingTargets.has(candidateId)) continue;
      candidates.set(candidateId, (candidates.get(candidateId) || 0) + 2);
    }
  }

  // 计算精确分数并排序
  const scored = [];
  for (const [candidateId, roughScore] of candidates) {
    const candidate = allUnits[candidateId];
    if (!candidate) continue;
    const score = computeMatchScore(unit, candidate);
    if (score >= CONFIG.scoreThreshold) {
      scored.push({ id: candidateId, score, unit: candidate });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

function getUnitTypeCode(unit) {
  if (unit._typeCode) return unit._typeCode;
  if (unit.id?.startsWith('CAS')) return 'CAS';
  if (unit.id?.startsWith('OPI')) return 'OPI';
  if (unit.id?.startsWith('CON')) return 'CON';
  if (unit.id?.startsWith('QST')) return 'QST';
  if (unit.id?.startsWith('SOL')) return 'SOL';
  return '';
}

function generateRelationships(unitId, matches) {
  const unit = allUnits[unitId];
  if (!unit) return [];

  const sourceType = getUnitTypeCode(unit);
  const rels = [];

  for (const match of matches) {
    if (rels.length >= CONFIG.maxRelationshipsPerUnit) break;

    const targetType = getUnitTypeCode(match.unit);
    const relType = determineRelationType(sourceType, targetType);
    const note = generateNote(unit, match.unit, relType);

    rels.push({
      type: relType,
      target: match.id,
      note: note.substring(0, 150), // 控制长度
      score: match.score
    });
  }

  return rels;
}

// ============ 写入操作 ============
function applyRelationships(unitId, newRels) {
  const unit = allUnits[unitId];
  if (!unit || !unit._filePath) return false;

  let content = fs.readFileSync(unit._filePath, 'utf-8');

  // 检查是否已有 relationships 块
  const relsMatch = content.match(/^relationships:\s*\[/m);
  const hasExistingRels = content.match(/^relationships:\s*\n\s{2}- type:/m);

  if (relsMatch && !hasExistingRels) {
    // relationships: [] → 替换为实际内容
    const newRelsBlock = 'relationships:\n' + newRels.map(r =>
      `  - type: ${r.type}\n    target: ${r.target}\n    note: ${r.note}`
    ).join('\n');
    content = content.replace(/^relationships:\s*\[\s*\]\s*$/m, newRelsBlock);
  } else if (hasExistingRels) {
    // 在现有relationships后面追加
    const newEntries = '\n' + newRels.map(r =>
      `  - type: ${r.type}\n    target: ${r.target}\n    note: ${r.note}`
    ).join('\n');

    // 找到relationships块的结束位置（下一个顶格字段或---）
    const relsStartIdx = content.indexOf('relationships:');
    const afterRels = content.substring(relsStartIdx);
    // 找到 relationships 块后面第一个非缩进非空行
    const lines = afterRels.split('\n');
    let insertIdx = 0;
    let inRels = false;
    let lastRelsLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0) { inRels = true; continue; }
      if (inRels && (line.startsWith('  - type:') || line.startsWith('    target:') || line.startsWith('    note:') || line.trim() === '')) {
        lastRelsLine = i;
        continue;
      }
      if (inRels && line.trim() !== '' && !line.startsWith('  ')) {
        insertIdx = i;
        break;
      }
      if (inRels) {
        lastRelsLine = i;
      }
    }
    if (insertIdx === 0) insertIdx = lastRelsLine + 1;

    const beforeInsert = lines.slice(0, insertIdx).join('\n');
    const afterInsert = lines.slice(insertIdx).join('\n');
    content = content.substring(0, relsStartIdx) + beforeInsert + newEntries + '\n' + afterInsert;
  } else {
    // 完全没有 relationships 字段 → 在 frontmatter 结尾 --- 前插入
    const fmEndMatch = content.match(/\n---\r?\n/);
    if (!fmEndMatch) return false;
    const fmEndIdx = content.indexOf(fmEndMatch[0]);

    const newRelsBlock = 'relationships:\n' + newRels.map(r =>
      `  - type: ${r.type}\n    target: ${r.target}\n    note: ${r.note}`
    ).join('\n') + '\n';

    content = content.substring(0, fmEndIdx) + '\n' + newRelsBlock + content.substring(fmEndIdx);
  }

  // 添加或更新 [[wiki links]] 在"关联单元"部分
  // 检查是否有"关联单元" section
  const relatedSection = content.match(/## 关联单元\s*\n/);
  let wikiLinks = newRels.map(r => {
    const targetFiles = allFiles[r.target];
    if (!targetFiles) return null;
    const fileName = targetFiles.fileName.replace('.md', '');
    return `- [[${fileName}]]`;
  }).filter(Boolean);

  // 去重
  const existingWikiLinks = new Set();
  const allWikiMatches = content.match(/\[\[([^\]]+)\]\]/g);
  if (allWikiMatches) {
    for (const m of allWikiMatches) {
      existingWikiLinks.add(m);
    }
  }
  wikiLinks = wikiLinks.filter(l => !existingWikiLinks.has(l.replace('- ', '')));

  if (wikiLinks.length > 0) {
    if (relatedSection) {
      // 追加到现有 ## 关联单元
      const insertPoint = content.indexOf('## 关联单元');
      const nextSection = content.indexOf('\n## ', insertPoint + 1);
      if (nextSection > 0) {
        content = content.substring(0, nextSection) + '\n' + wikiLinks.join('\n') + '\n' + content.substring(nextSection);
      } else {
        // 在文件末尾追加
        content = content.trimEnd() + '\n' + wikiLinks.join('\n') + '\n';
      }
    } else {
      // 在文件末尾添加 ## 关联单元
      content = content.trimEnd() + '\n\n## 关联单元\n\n' + wikiLinks.join('\n') + '\n';
    }
  }

  fs.writeFileSync(unit._filePath, content, 'utf-8');
  return true;
}

// ============ 主流程 ============
function main() {
  console.log('🔧 鲁大魔知识库 - 全库自动连接脚本');
  console.log(`模式: ${MODE.toUpperCase()}`);
  console.log('='.repeat(60));

  loadAllUnits();

  // 统计当前状态
  let totalUnits = 0;
  let unitsWithRels = 0;
  let unitsWithoutRels = 0;
  const unlinkedByType = {};

  for (const [id, unit] of Object.entries(allUnits)) {
    totalUnits++;
    const hasRels = (unit.relationships || []).length > 0;
    if (hasRels) {
      unitsWithRels++;
    } else {
      unitsWithoutRels++;
      const tc = getUnitTypeCode(unit);
      unlinkedByType[tc] = (unlinkedByType[tc] || 0) + 1;
    }
  }

  console.log(`\n📈 当前状态:`);
  console.log(`  总单元数: ${totalUnits}`);
  console.log(`  已有连接: ${unitsWithRels} (${(unitsWithRels/totalUnits*100).toFixed(1)}%)`);
  console.log(`  未连接: ${unitsWithoutRels} (${(unitsWithoutRels/totalUnits*100).toFixed(1)}%)`);
  console.log(`  未连接分布:`, unlinkedByType);

  // 对每个未连接单元找匹配
  console.log(`\n🔍 开始匹配分析...`);
  const results = [];
  let processed = 0;

  for (const [id, unit] of Object.entries(allUnits)) {
    const hasRels = (unit.relationships || []).length > 0;
    if (hasRels) continue; // 只处理没有关系的单元

    const matches = findBestMatches(id);
    if (matches.length === 0) {
      processed++;
      continue;
    }

    const newRels = generateRelationships(id, matches);
    if (newRels.length === 0) {
      processed++;
      continue;
    }

    results.push({
      id,
      type: getUnitTypeCode(unit),
      title: unit.title,
      currentRels: (unit.relationships || []).length,
      newRels: newRels.map(r => ({ type: r.type, target: r.target, score: r.score.toFixed(2) })),
    });

    // Apply changes
    if (MODE === 'apply') {
      const success = applyRelationships(id, newRels);
      if (success) {
        console.log(`  ✅ ${id}: +${newRels.length} 关系 → ${newRels.map(r=>r.target).join(', ')}`);
      } else {
        console.log(`  ❌ ${id}: 写入失败`);
      }
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`  ...已处理 ${processed}/${unitsWithoutRels}`);
    }
  }

  // 输出报告
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 ${MODE === 'apply' ? '执行' : '预览'}报告`);
  console.log(`  处理单元数: ${processed}`);
  console.log(`  找到匹配: ${results.length}`);
  console.log(`  总新增关系: ${results.reduce((s, r) => s + r.newRels.length, 0)}`);

  // 按类型统计
  const byType = {};
  for (const r of results) {
    byType[r.type] = (byType[r.type] || 0) + 1;
  }
  console.log(`  按类型分布:`, byType);

  // 关系类型统计
  const relTypeCount = {};
  for (const r of results) {
    for (const rel of r.newRels) {
      relTypeCount[rel.type] = (relTypeCount[rel.type] || 0) + 1;
    }
  }
  console.log(`  关系类型分布:`, relTypeCount);

  // 仍无连接
  const stillUnlinked = [];
  for (const [id, unit] of Object.entries(allUnits)) {
    const hasRels = (unit.relationships || []).length > 0;
    if (!hasRels) stillUnlinked.push({ id, type: getUnitTypeCode(unit), title: unit.title });
  }
  console.log(`  仍无连接: ${stillUnlinked.length}`);
  if (stillUnlinked.length > 0 && stillUnlinked.length <= 30) {
    for (const u of stillUnlinked) {
      console.log(`    - ${u.id} (${u.type}): ${u.title?.substring(0, 50)}`);
    }
  }

  // 如果dry-run模式，输出一些样例
  if (MODE === 'dry-run' && results.length > 0) {
    console.log(`\n📝 样例预览 (前10个):`);
    for (const r of results.slice(0, 10)) {
      console.log(`\n  ${r.id} (${r.type}): ${r.title?.substring(0, 40)}`);
      for (const rel of r.newRels.slice(0, 3)) {
        console.log(`    → ${rel.type} → ${rel.target} (分数:${rel.score})`);
      }
    }
  }

  console.log(`\n💡 ${MODE === 'dry-run' ? '确认无误后运行: node auto-connect-all.js --apply' : '已完成！'}`);
}

main();

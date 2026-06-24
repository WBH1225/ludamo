// enrich-thin-connections.js — 为连接稀疏的内容单元丰富关系
// 基于themes/keywords匹配，补充OPI→CON, OPI→OPI, CAS→OPI关系
// 模式: node enrich-thin-connections.js [--apply]

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const UNIT_DIR = path.join(BASE, '02-内容单元库');
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';

const CONFIG = {
  minRelsToEnrich: 3,   // YAML关系数少于此值才需要富化
  targetRelsCount: 5,    // 富化目标：每个单元至少有这么多种关系
  maxNewRels: 4,         // 单次最多添加的关系数
  minThemeOverlap: 1,    // 最低主题重叠数
};

// ============ 解析 ============
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { raw: '', body: content, themes: [], keywords: [], relationships: [], id: '', title: '' };
  const raw = match[1];
  const body = content.substring(match[0].length);
  const fm = { raw, body, themes: [], keywords: [], relationships: [], id: '', title: '' };

  ['id', 'type', 'title', 'status'].forEach(f => {
    const m = raw.match(new RegExp(`^${f}:\\s*(.+)$`, 'm'));
    if (m) fm[f] = m[1].trim();
  });

  ['themes', 'keywords'].forEach(field => { fm[field] = parseList(raw, field); });
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
    const t = line.trim();
    if (t.startsWith('- type:')) {
      if (current && current.target) rels.push(current);
      current = { type: t.slice('- type:'.length).trim(), target: '', note: '' };
      continue;
    }
    if (t !== '' && !line.startsWith('  ') && !line.startsWith('\t')) {
      if (current && current.target) rels.push(current);
      break;
    }
    if (!current) continue;
    if (t.startsWith('target:')) current.target = t.slice('target:'.length).trim();
    if (t.startsWith('note:')) current.note = t.slice('note:'.length).trim();
  }
  if (current && current.target) rels.push(current);
  return rels;
}

// ============ 索引 ============
function buildIndexes() {
  const allUnits = {}; // id → { themes, keywords, title, type, filePath, relationships }
  const byTheme = {};  // theme → [id, ...]

  for (const typeDir of fs.readdirSync(UNIT_DIR)) {
    const dir = path.join(UNIT_DIR, typeDir);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const fp = path.join(dir, file);
      const content = fs.readFileSync(fp, 'utf-8');
      const fm = parseFrontmatter(content);
      if (!fm.id) continue;

      allUnits[fm.id] = {
        themes: fm.themes || [],
        keywords: fm.keywords || [],
        title: fm.title || '',
        type: typeDir,
        filePath: fp,
        relationships: fm.relationships || [],
      };

      for (const theme of (fm.themes || [])) {
        if (!byTheme[theme]) byTheme[theme] = [];
        byTheme[theme].push(fm.id);
      }
    }
  }

  return { allUnits, byTheme };
}

// ============ 匹配 ============
function jaccardSim(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a), sb = new Set(b);
  let intersection = 0;
  for (const x of sa) { if (sb.has(x)) intersection++; }
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findBestTargets(sourceId, allUnits, byTheme, existingTargets, maxResults = 8) {
  const source = allUnits[sourceId];
  if (!source) return [];

  const candidates = new Map();

  // 通过主题找候选
  for (const theme of (source.themes || [])) {
    for (const cid of (byTheme[theme] || [])) {
      if (cid === sourceId) continue;
      if (existingTargets.has(cid)) continue;
      candidates.set(cid, (candidates.get(cid) || 0) + 3);
    }
  }

  // 计算精确分数
  const scored = [];
  for (const [cid, roughScore] of candidates) {
    const target = allUnits[cid];
    if (!target) continue;
    const themeScore = jaccardSim(source.themes, target.themes) * 3;
    const kwScore = jaccardSim(source.keywords, target.keywords) * 2;
    const score = themeScore + kwScore;
    if (score >= 0.15) scored.push({ id: cid, score, type: target.type });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

function determineRelType(sourceType, targetType) {
  // 仅限于规则规定的四类：回应、解释、证明、冲突
  // OPI → CON: 证明 (观点证明概念) 或 解释 (概念解释观点)
  if (sourceType === 'OPI' && targetType === 'CON') return '证明';
  // CON → OPI: 解释 (概念解释观点)
  if (sourceType === 'CON' && targetType === 'OPI') return '解释';
  // OPI → OPI: 回应 (观点回应观点)
  if (sourceType === 'OPI' && targetType === 'OPI') return '回应';
  // CAS → OPI: 证明 (案例证明观点)
  if (sourceType === 'CAS' && targetType === 'OPI') return '证明';
  // CAS → CON: 证明 (案例证明概念)
  if (sourceType === 'CAS' && targetType === 'CON') return '证明';
  // QST → OPI: 回应 (问题→观点回应)
  if (sourceType === 'QST' && targetType === 'OPI') return '回应';
  // QST → CON: 回应 (问题→概念回应)
  if (sourceType === 'QST' && targetType === 'CON') return '回应';
  // SOL → QST: 回应 (方案回应问题)
  if (sourceType === 'SOL' && targetType === 'QST') return '回应';
  // CAS → CAS: 回应 (案例间相互参照)
  if (sourceType === 'CAS' && targetType === 'CAS') return '回应';
  // CAS → QST: 证明 (案例证明问题存在)
  if (sourceType === 'CAS' && targetType === 'QST') return '证明';
  // OPI → CAS: 证明 (观点引用案例为证)
  if (sourceType === 'OPI' && targetType === 'CAS') return '证明';
  // CON → CON: 解释 (概念间互释)
  if (sourceType === 'CON' && targetType === 'CON') return '解释';
  // 默认：回应
  return '回应';
}

// ============ 写入 ============
function addRelationshipsToFile(filePath, newRels) {
  let content = fs.readFileSync(filePath, 'utf-8');

  // 生成YAML条目
  const yamlEntries = newRels.map(r =>
    `  - type: ${r.type}\n    target: ${r.target}\n    note: ${r.note}`
  ).join('\n');

  // 找到relationships块的末尾
  const relsMatch = content.match(/^relationships:\s*\[/m);
  if (relsMatch) {
    // relationships: [] → 替换
    content = content.replace(/^relationships:\s*\[\s*\]\s*$/m, 'relationships:\n' + yamlEntries);
  } else {
    // 已有关系 → 追加到块的末尾（在下一个顶格字段或---之前）
    const relsStart = content.indexOf('relationships:');
    if (relsStart === -1) {
      // 无relationships字段 → 在frontmatter的---前插入
      const fmEnd = content.indexOf('---', 4);
      if (fmEnd > 0) {
        content = content.substring(0, fmEnd) + 'relationships:\n' + yamlEntries + '\n' + content.substring(fmEnd);
      }
    } else {
      // 追加到现有关系
      const afterRels = content.substring(relsStart);
      const lines = afterRels.split('\n');
      let insertLine = 0;
      let inRels = false;
      for (let i = 0; i < lines.length; i++) {
        if (i === 0) { inRels = true; continue; }
        if (inRels && (lines[i].startsWith('  - type:') || lines[i].startsWith('    target:') || lines[i].startsWith('    note:') || lines[i].trim() === '')) {
          insertLine = i;
          continue;
        }
        if (inRels && lines[i].trim() !== '') break;
        if (inRels) insertLine = i;
      }
      const insertPos = relsStart + lines.slice(0, insertLine + 1).join('\n').length;
      content = content.substring(0, insertPos) + '\n' + yamlEntries + '\n' + content.substring(insertPos);
    }
  }

  // 添加 wiki links
  const wikiLinks = newRels.map(r => {
    const target = allUnitsInfo[r.target];
    return target ? `[[${target.fileName}]]` : null;
  }).filter(Boolean);

  const newWiki = wikiLinks.filter(l => !content.includes(l));
  if (newWiki.length > 0) {
    const relatedSection = content.match(/## 关联单元/);
    if (relatedSection) {
      const idx = content.indexOf('## 关联单元');
      const nextSection = content.indexOf('\n## ', idx + 1);
      if (nextSection > 0) {
        content = content.substring(0, nextSection) + '\n' + newWiki.join('\n') + '\n' + content.substring(nextSection);
      } else {
        content = content.trimEnd() + '\n' + newWiki.join('\n') + '\n';
      }
    } else {
      content = content.trimEnd() + '\n\n## 关联单元\n\n' + newWiki.join('\n') + '\n';
    }
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return newRels.length + newWiki.length;
}

// 全局unit索引（用于生成wiki链接）
let allUnitsInfo = {};

function main() {
  console.log('🔧 丰富稀疏连接');
  console.log(`模式: ${MODE.toUpperCase()}`);
  console.log(`最小关系数阈值: ${CONFIG.minRelsToEnrich}`);
  console.log('='.repeat(60));

  const { allUnits, byTheme } = buildIndexes();

  // 构建wiki链接索引
  for (const [id, unit] of Object.entries(allUnits)) {
    allUnitsInfo[id] = {
      fileName: path.basename(unit.filePath, '.md'),
      type: unit.type,
    };
  }

  console.log(`📊 总单元: ${Object.keys(allUnits).length}`);
  console.log(`  主题索引: ${Object.keys(byTheme).length} 个独特主题`);

  // 找需要富化的单元
  const toEnrich = [];
  for (const [id, unit] of Object.entries(allUnits)) {
    if (unit.relationships.length < CONFIG.minRelsToEnrich) {
      toEnrich.push({ id, ...unit });
    }
  }

  console.log(`  需要富化: ${toEnrich.length} 个 (关系数<${CONFIG.minRelsToEnrich})`);

  // 按类型统计
  const byType = {};
  for (const u of toEnrich) { byType[u.type] = (byType[u.type] || 0) + 1; }
  console.log(`  分布:`, byType);

  // 逐个处理
  let enriched = 0;
  let totalNewRels = 0;

  for (const unit of toEnrich) {
    const existingTargets = new Set(unit.relationships.map(r => r.target));
    const matches = findBestTargets(unit.id, allUnits, byTheme, existingTargets);

    if (matches.length === 0) continue;

    // 优先匹配不同类型的单元，增加多样性
    const currentTypes = new Set(unit.relationships.map(r => {
      const t = allUnits[r.target];
      return t ? t.type : '';
    }));

    const diverseMatches = matches.filter(m => !currentTypes.has(m.type));
    const finalMatches = [...diverseMatches, ...matches].slice(0, CONFIG.maxNewRels);

    if (finalMatches.length === 0) continue;

    const newRels = finalMatches.map(m => ({
      type: determineRelType(unit.type, m.type),
      target: m.id,
      note: `共享主题匹配——score:${m.score.toFixed(2)}`
    }));

    if (MODE === 'apply') {
      const added = addRelationshipsToFile(unit.filePath, newRels);
      totalNewRels += newRels.length;
      enriched++;
      if (enriched % 100 === 0) console.log(`  ...已富化 ${enriched}/${toEnrich.length}`);
    } else {
      totalNewRels += newRels.length;
      enriched++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 ${MODE === 'apply' ? '执行' : '预览'}完成`);
  console.log(`  富化单元数: ${enriched}`);
  console.log(`  新增关系数: ${totalNewRels}`);
  console.log(`  仍不足${CONFIG.minRelsToEnrich}条: ${toEnrich.length - enriched}`);

  if (MODE === 'dry-run') {
    // 输出样例
    console.log(`\n📝 样例预览 (前5个):`);
    let shown = 0;
    for (const unit of toEnrich.slice(0, 20)) {
      if (shown >= 5) break;
      const existingTargets = new Set(unit.relationships.map(r => r.target));
      const matches = findBestTargets(unit.id, allUnits, byTheme, existingTargets);
      if (matches.length === 0) continue;
      console.log(`\n  ${unit.id} (${unit.type}): ${unit.title?.substring(0, 40)}`);
      console.log(`    当前关系: ${unit.relationships.length} → ${unit.relationships.map(r=>r.target).join(', ')}`);
      const currentTypes = new Set(unit.relationships.map(r => allUnits[r.target]?.type || ''));
      const diverse = matches.filter(m => !currentTypes.has(m.type));
      console.log(`    建议新增: ${matches.slice(0, 4).map(m => `${determineRelType(unit.type, m.type)}→${m.id}(${m.type})`).join(', ')}`);
      shown++;
    }
    console.log(`\n💡 确认无误后运行: node 07-脚本与工具/enrich-thin-connections.js --apply`);
  }
}

main();

const fs = require('fs');
const path = require('path');

const ldDir = '01-原始素材区/完整副本/对话';
const referenced = new Set();
['QST','OPI','CON','CAS','SOL'].forEach(sd => {
  const full = path.join('02-内容单元库', sd);
  if (!fs.existsSync(full)) return;
  fs.readdirSync(full).forEach(f => {
    if (!f.endsWith('.md')) return;
    const content = fs.readFileSync(path.join(full, f), 'utf8');
    const srcs = content.match(/SRC-(LD-\d+)/g);
    if (srcs) srcs.forEach(s => referenced.add(s.replace('SRC-', '')));
  });
});

// 1. HIGH-WEIGHT UNREFERENCED LDs: extract core insights
console.log('=== 1. 高权重未引用LD核心洞见 (weight>=8) ===\n');

const highWeight = [];
fs.readdirSync(ldDir).forEach(f => {
  if (!f.endsWith('.md')) return;
  const ldId = f.replace('.md', '');
  if (referenced.has(ldId)) return;
  const content = fs.readFileSync(path.join(ldDir, f), 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return;
  const fmText = fm[1];
  const weight = parseInt((fmText.match(/^weight_score:\s*(\d+)/m) || ['',0])[1]) || 0;
  if (weight >= 8) {
    const title = (content.match(/# LD-\d+ · (.+)/) || ['','?'])[1];
    const spectrum = (fmText.match(/^spectrum:\s*"?(.+?)"?$/m) || ['','?'])[1];
    const lock = (fmText.match(/^lock_type:\s*"?(.+?)"?$/m) || ['','?'])[1];
    const tags = (fmText.match(/^tags:\s*\[(.+)\]/m) || ['',''])[1];
    // Get 鲁大魔 section
    const ldm = content.match(/### 鲁大魔[\s\S]*?(?=\n##|\n---|$)/);
    const insight = ldm ? ldm[0].slice(0, 400) : '(none)';
    highWeight.push({id: ldId, weight, title, spectrum, lock, tags, insight});
  }
});

highWeight.sort((a,b) => b.weight - a.weight);
highWeight.slice(0, 15).forEach(l => {
  console.log('⭐' + l.weight + ' ' + l.id + ': ' + l.title);
  console.log('   [' + l.spectrum + '|' + l.lock + '] tags: ' + l.tags);
  // Extract the key L1/L2 line (the core claim)
  const l1Match = l.insight.match(/\*\*L1\*\*\s*\*?"([^"]+)"/);
  if (l1Match) console.log('   核心话术: "' + l1Match[1].slice(0, 150) + '"');
  const l2Match = l.insight.match(/\*\*L2\*\*\s*\*\*(.+?)\*\*/);
  if (l2Match) console.log('   核心判断: ' + l2Match[1].slice(0, 150));
  console.log('');
});

// 2. AI/TECH THEME: find unique patterns
console.log('=== 2. AI/技术主题LD独特模式 (87个LD中抽样) ===\n');

const aiKeywords = ['AI', '人工智能', '技术', '自动化', '编程', '算法', 'SaaS', '软件', '工具', '豆包', 'ChatGPT', 'AI替代', 'AI风控', 'AI焦虑'];
const aiLDs = [];
fs.readdirSync(ldDir).forEach(f => {
  if (!f.endsWith('.md')) return;
  const ldId = f.replace('.md', '');
  if (referenced.has(ldId)) return;
  const content = fs.readFileSync(path.join(ldDir, f), 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return;
  const fmText = fm[1];
  const tagsMatch = fmText.match(/^tags:\s*\[(.+)\]/m);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [];
  const title = (content.match(/# LD-\d+ · (.+)/) || ['','?'])[1];
  const match = tags.some(t => aiKeywords.includes(t)) || aiKeywords.some(k => title.includes(k));
  if (match) {
    const weight = parseInt((fmText.match(/^weight_score:\s*(\d+)/m) || ['',0])[1]) || 0;
    const ldm = content.match(/### 鲁大魔[\s\S]*?(?=\n##|\n---|$)/);
    aiLDs.push({id: ldId, weight, title, tags, insight: ldm ? ldm[0].slice(0, 400) : '(none)'});
  }
});

aiLDs.sort((a,b) => b.weight - a.weight);
// Show diverse samples across different AI sub-themes
const aiSamples = aiLDs.slice(0, 8);
aiSamples.forEach(l => {
  console.log('⭐' + l.weight + ' ' + l.id + ': ' + l.title);
  console.log('   tags: ' + l.tags.join(', '));
  const l1Match = l.insight.match(/\*\*L1\*\*\s*\*?"([^"]+)/);
  if (l1Match) console.log('   话术: "' + l1Match[1].slice(0, 150) + '"');
  const l2Match = l.insight.match(/\*\*L2\*\*\s*\*\*(.+?)\*\*/);
  if (l2Match) console.log('   判断: ' + l2Match[1].slice(0, 150));
  console.log('');
});

// 3. Find patterns that might BREAK the existing framework
console.log('=== 3. 框架边缘案例 ===\n');
// Look for: 反身 files with unique patterns, unusual spectrum/lock combos
const edgeCases = [];
fs.readdirSync(ldDir).forEach(f => {
  if (!f.endsWith('.md')) return;
  const content = fs.readFileSync(path.join(ldDir, f), 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return;
  const fmText = fm[1];
  const spectrum = (fmText.match(/^spectrum:\s*"?(.+?)"?$/m) || ['','?'])[1];
  const route = (fmText.match(/^route_primary:\s*(.+?)$/m) || ['','?'])[1];
  // Find unusual combos
  if (route === '反身' || route === '边界声明') {
    const ldId = f.replace('.md', '');
    const title = (content.match(/# LD-\d+ · (.+)/) || ['','?'])[1];
    const weight = parseInt((fmText.match(/^weight_score:\s*(\d+)/m) || ['',0])[1]) || 0;
    const tags = (fmText.match(/^tags:\s*\[(.+)\]/m) || ['',''])[1];
    edgeCases.push({id: ldId, weight, title, spectrum, route, tags});
  }
});
edgeCases.sort((a,b) => b.weight - a.weight);
edgeCases.forEach(e => {
  console.log('⭐' + e.weight + ' ' + e.id + ': ' + e.title + ' [' + e.route + '|' + e.spectrum + ']');
  console.log('   tags: ' + e.tags);
});

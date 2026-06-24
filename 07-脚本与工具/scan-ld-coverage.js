const fs = require('fs');
const path = require('path');

const ldDir = '01-原始素材区/完整副本/对话';

// Get referenced LDs (from content units' source_documents)
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

// Also from topic maps
fs.readdirSync('05-主题地图').forEach(f => {
  if (!f.endsWith('.md')) return;
  const content = fs.readFileSync(path.join('05-主题地图', f), 'utf8');
  const refs = content.match(/\[\[LD-\d+/g);
  if (refs) refs.forEach(r => referenced.add(r.replace('[[', '')));
});

// Scan ALL LDs for patterns
const allLDs = {};
fs.readdirSync(ldDir).forEach(f => {
  if (!f.endsWith('.md')) return;
  const ldId = f.replace('.md', '');
  const content = fs.readFileSync(path.join(ldDir, f), 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return;
  const fmText = fm[1];
  const spectrum = (fmText.match(/^spectrum:\s*"?(.+?)"?$/m) || ['','?'])[1];
  const lock = (fmText.match(/^lock_type:\s*"?(.+?)"?$/m) || ['','?'])[1];
  const route = (fmText.match(/^route_primary:\s*(.+?)$/m) || ['','?'])[1];
  const weight = (fmText.match(/^weight_score:\s*(\d+)/m) || ['',0])[1];
  const tagsMatch = fmText.match(/^tags:\s*\[(.+)\]/m);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [];
  const title = (content.match(/# LD-\d+ · (.+)/) || ['','?'])[1];

  allLDs[ldId] = {
    spectrum, lock, route, weight: parseInt(weight) || 0, tags, title,
    referenced: referenced.has(ldId)
  };
});

// ====== ANALYSIS ======

// 1. Tag distribution in unreferenced vs referenced LDs
const refTags = {};
const unrefTags = {};
Object.values(allLDs).forEach(ld => {
  const bucket = ld.referenced ? refTags : unrefTags;
  ld.tags.forEach(t => {
    bucket[t] = (bucket[t] || 0) + 1;
  });
});

// Find tags that appear in unreferenced but NOT in referenced
const refTagSet = new Set(Object.keys(refTags));
const unrefOnly = Object.entries(unrefTags)
  .filter(([tag]) => !refTagSet.has(tag))
  .sort((a,b) => b[1] - a[1]);

console.log('=== LD覆盖分析 ===');
console.log('总LD: ' + Object.keys(allLDs).length);
console.log('已引用: ' + referenced.size + ' (' + (referenced.size/Object.keys(allLDs).length*100).toFixed(1) + '%)');
console.log('未引用: ' + (Object.keys(allLDs).length - referenced.size));
console.log('');

// 2. Route distribution in unreferenced
const unrefRoutes = {};
Object.values(allLDs).filter(ld => !ld.referenced).forEach(ld => {
  unrefRoutes[ld.route] = (unrefRoutes[ld.route] || 0) + 1;
});
console.log('--- 未引用LD的route分布 ---');
Object.entries(unrefRoutes).sort((a,b) => b[1]-a[1]).forEach(([r,c]) => {
  console.log('  ' + r + ': ' + c);
});

// 3. Tags unique to unreferenced (top 30)
console.log('');
console.log('--- 未引用LD独有标签 (可能含遗漏模式) Top 30 ---');
unrefOnly.slice(0, 30).forEach(([tag, count]) => {
  console.log('  ' + tag + ': ' + count + '次');
});

// 4. High-weight unreferenced LDs (⭐ and above)
console.log('');
console.log('--- 高权重但未引用的LD (weight>=5) Top 20 ---');
const highUnref = Object.entries(allLDs)
  .filter(([id, ld]) => !ld.referenced && ld.weight >= 5)
  .sort((a,b) => b[1].weight - a[1].weight)
  .slice(0, 20);
highUnref.forEach(([id, ld]) => {
  console.log('  ' + id + ': ⭐' + ld.weight + ' | ' + ld.title + ' | ' + ld.spectrum + ' | ' + ld.lock + ' | tags: ' + ld.tags.slice(0,5).join(', '));
});

// 5. Tag clusters in unreferenced — find themes
console.log('');
console.log('--- 未引用LD的标签聚类(潜在遗漏主题) ---');
const themeGroups = {
  'AI/技术': ['AI', '人工智能', '技术', '自动化', '编程', '算法', 'SaaS', '软件', '工具'],
  '实体/线下': ['实体', '线下', '门店', '餐饮', '工厂', '供应链', '库存', '批发', '制造业'],
  '情感/关系': ['情感', '恋爱', '婚姻', '家庭', '亲子', '父母', '兄弟', '合伙', '背叛', '信任'],
  '投资/金融': ['投资', '股票', '基金', '币圈', 'Web3', '区块链', 'NFT', '金融', '理财', '房产'],
  '内容/IP': ['IP', '个人IP', '自媒体', '写作', '短视频', '直播', '流量', '粉丝', '内容'],
  '教育/学习': ['教育', '学习', '考研', '大学', '读书', '知识', '认知', '思维'],
  '健康/医疗': ['健康', '医疗', '中医', '心理', '焦虑', '抑郁'],
  '法律/合规': ['法律', '合规', '税务', '合同', '知识产权'],
};
const themeHits = {};
Object.entries(themeGroups).forEach(([theme, keywords]) => {
  themeHits[theme] = {count: 0, sampleIds: [], sampleTags: new Set()};
  Object.entries(allLDs).filter(([id, ld]) => !ld.referenced).forEach(([id, ld]) => {
    const match = ld.tags.some(t => keywords.includes(t)) || keywords.some(k => ld.title.includes(k));
    if (match) {
      themeHits[theme].count++;
      if (themeHits[theme].sampleIds.length < 3) themeHits[theme].sampleIds.push(id);
      ld.tags.forEach(t => themeHits[theme].sampleTags.add(t));
    }
  });
});
Object.entries(themeHits).sort((a,b) => b[1].count - a[1].count).forEach(([theme, info]) => {
  if (info.count > 0) {
    console.log('  ' + theme + ': ' + info.count + '个LD (样本: ' + info.sampleIds.join(', ') + ')');
    console.log('    典型标签: ' + [...info.sampleTags].slice(0,8).join(', '));
  }
});

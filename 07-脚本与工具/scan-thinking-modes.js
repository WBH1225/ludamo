const fs = require('fs');
const path = require('path');

const ldDir = '01-原始素材区/完整副本/对话';

// Get referenced LDs
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

// Specific thinking modes to look for
const targetModes = ['逆向思维', '创新思维', '复利思维', '概念借用', '环境决定论', '瓶颈定位', '行业规律对照', '行为证据', '获客', '生存技能'];

// Scan all LDs
const modeLDs = {};
targetModes.forEach(m => { modeLDs[m] = []; });

fs.readdirSync(ldDir).forEach(f => {
  if (!f.endsWith('.md')) return;
  const ldId = f.replace('.md', '');
  const content = fs.readFileSync(path.join(ldDir, f), 'utf8');
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return;
  const fmText = fm[1];
  const tagsMatch = fmText.match(/^tags:\s*\[(.+)\]/m);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [];
  const spectrum = (fmText.match(/^spectrum:\s*"?(.+?)"?$/m) || ['','?'])[1];
  const lock = (fmText.match(/^lock_type:\s*"?(.+?)"?$/m) || ['','?'])[1];
  const weight = parseInt((fmText.match(/^weight_score:\s*(\d+)/m) || ['',0])[1]) || 0;
  const title = (content.match(/# LD-\d+ · (.+)/) || ['','?'])[1];
  const isRef = referenced.has(ldId);

  targetModes.forEach(mode => {
    if (tags.includes(mode)) {
      modeLDs[mode].push({id: ldId, title, spectrum, lock, weight, ref: isRef, tags});
    }
  });
});

// Report
console.log('=== 思维模式在LD中的分布 ===\n');
targetModes.forEach(mode => {
  const lds = modeLDs[mode];
  const refCount = lds.filter(l => l.ref).length;
  const unrefCount = lds.filter(l => !l.ref).length;
  const highWeight = lds.filter(l => l.weight >= 5 && !l.ref);
  console.log(mode + ': 总计' + lds.length + ' (已引用' + refCount + ' 未引用' + unrefCount + ' 高权重未引用' + highWeight.length + ')');
  if (highWeight.length > 0) {
    highWeight.slice(0, 5).forEach(l => {
      console.log('  ⭐' + l.weight + ' ' + l.id + ': ' + l.title + ' [' + l.spectrum + '|' + l.lock + ']');
    });
  }
  console.log('');
});

// Now sample actual content from 逆向思维 LDs to understand the pattern
console.log('=== 逆向思维 样本内容 ===');
const reverseSamples = modeLDs['逆向思维'].filter(l => !l.ref).slice(0, 3);
reverseSamples.forEach(l => {
  const content = fs.readFileSync(path.join(ldDir, l.id + '.md'), 'utf8');
  const ldmSection = content.match(/### 鲁大魔[\s\S]*?(?=\n##|\n---|$)/);
  const text = ldmSection ? ldmSection[0].slice(0, 500) : '(no 鲁大魔 section)';
  console.log('--- ' + l.id + ': ' + l.title + ' ---');
  console.log(text);
  console.log('');
});

// Sample 概念借用
console.log('=== 概念借用 样本内容 ===');
const conceptSamples = modeLDs['概念借用'].filter(l => !l.ref).slice(0, 2);
conceptSamples.forEach(l => {
  const content = fs.readFileSync(path.join(ldDir, l.id + '.md'), 'utf8');
  const ldmSection = content.match(/### 鲁大魔[\s\S]*?(?=\n##|\n---|$)/);
  const text = ldmSection ? ldmSection[0].slice(0, 500) : '(none)';
  console.log('--- ' + l.id + ': ' + l.title + ' ---');
  console.log(text);
  console.log('');
});

// Sample 环境决定论
console.log('=== 环境决定论 样本内容 ===');
const envSamples = modeLDs['环境决定论'].filter(l => !l.ref).slice(0, 2);
envSamples.forEach(l => {
  const content = fs.readFileSync(path.join(ldDir, l.id + '.md'), 'utf8');
  const ldmSection = content.match(/### 鲁大魔[\s\S]*?(?=\n##|\n---|$)/);
  const text = ldmSection ? ldmSection[0].slice(0, 500) : '(none)';
  console.log('--- ' + l.id + ': ' + l.title + ' ---');
  console.log(text);
  console.log('');
});

// Sample 瓶颈定位
console.log('=== 瓶颈定位 样本内容 ===');
const bottleneckSamples = modeLDs['瓶颈定位'].filter(l => !l.ref).slice(0, 2);
bottleneckSamples.forEach(l => {
  const content = fs.readFileSync(path.join(ldDir, l.id + '.md'), 'utf8');
  const ldmSection = content.match(/### 鲁大魔[\s\S]*?(?=\n##|\n---|$)/);
  const text = ldmSection ? ldmSection[0].slice(0, 500) : '(none)';
  console.log('--- ' + l.id + ': ' + l.title + ' ---');
  console.log(text);
  console.log('');
});

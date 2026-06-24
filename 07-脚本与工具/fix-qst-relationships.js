// Fix QST relationships: convert # 入向 comments to structured relationships
const fs = require('fs');
const path = require('path');

const fixes = {
  'QST-001': [
    {type: '回应', target: 'OPI-001', note: 'OPI-001直接回应"品牌有没有戏"的资源拼凑型问题'},
    {type: '解释', target: 'CON-001', note: 'CON-001解释行业存量玩家的行为逻辑，揭示为什么资源拼凑不可行'},
    {type: '回应', target: 'SOL-001', note: 'SOL-001给出从零到一的路径：先有你自己的一个东西'},
    {type: '证明', target: 'CAS-001', note: 'CAS-001羽毛球品牌梦完整证明资源拼凑→路径过长→必死'},
  ],
  'QST-002': [
    {type: '回应', target: 'OPI-002', note: 'OPI-002回应增长瓶颈：电商真正赚钱的都是做供应链的'},
    {type: '回应', target: 'SOL-002', note: 'SOL-002给出正确顺序：测品优先于选区域'},
    {type: '证明', target: 'CAS-002', note: 'CAS-002 TK带货月入十几万证明半个生意的天花板'},
    {type: '解释', target: 'CON-003', note: 'CON-003人力漏斗解释为什么后端能力需要系统而非渠道'},
  ],
  'QST-003': [
    {type: '回应', target: 'OPI-003', note: 'OPI-003翻转"我废了"→不是人废了是城市剥夺了专注力'},
    {type: '回应', target: 'SOL-003', note: 'SOL-003给出具体方案：自驾旷野重置换环境'},
    {type: '解释', target: 'CON-002', note: 'CON-002焦虑覆盖原理解释为什么专注力问题≠性格缺陷'},
  ],
  'QST-004': [
    {type: '回应', target: 'OPI-004', note: 'OPI-004回应捷径幻想：团队是漏斗筛选出来的不是一次招到的'},
    {type: '回应', target: 'SOL-004', note: 'SOL-004给出招聘漏斗四步法的具体执行'},
    {type: '解释', target: 'CON-003', note: 'CON-003人力漏斗解释搭团队的系统流程'},
  ],
  'QST-005': [
    {type: '回应', target: 'OPI-006', note: 'OPI-006回应数据造假：数据验证不需要讨论，只需一个可证伪的动作'},
    {type: '解释', target: 'CON-005', note: 'CON-005证伪思维解释用可证伪动作替代辩论的底层逻辑'},
  ],
  'QST-006': [
    {type: '回应', target: 'OPI-007', note: 'OPI-007回应正反馈误读：把正反馈当深耕信号而非跳板'},
  ],
  'QST-007': [
    {type: '回应', target: 'OPI-012', note: 'OPI-012回应抄袭成功：赚到钱不等于懂赚钱，盈利可能只是抄对了'},
  ],
  'QST-008': [
    {type: '回应', target: 'OPI-015', note: 'OPI-015直接回应假迷茫：你不是迷茫——你就是懒'},
  ],
  'QST-009': [
    {type: '解释', target: 'CON-005', note: '三分法拆解的核心是证伪思维——把乱炖拆成独立问题各自验证'},
  ],
  'QST-010': [
    {type: '回应', target: 'OPI-017', note: 'OPI-017回应目标迷失：钱是需求的副产品，别数钱回去找需求'},
  ],
  'QST-011': [
    {type: '回应', target: 'OPI-019', note: 'OPI-019回应多数人叙事：不是他不合群——是其他人合起来排斥他'},
  ],
};

const qstDir = '02-内容单元库/QST';
let count = 0;

for (const [qstId, rels] of Object.entries(fixes)) {
  // Find the file
  const files = fs.readdirSync(qstDir).filter(f => f.startsWith(qstId + '_') && f.endsWith('.md'));
  if (files.length === 0) {
    console.log('NOT FOUND: ' + qstId);
    continue;
  }
  const filePath = path.join(qstDir, files[0]);
  let content = fs.readFileSync(filePath, 'utf8');

  // Build new relationships YAML
  let newRels = 'relationships:\n';
  for (const rel of rels) {
    newRels += `  - type: ${rel.type}\n`;
    newRels += `    target: ${rel.target}\n`;
    if (rel.note) newRels += `    note: ${rel.note}\n`;
  }

  // Replace the old relationships: [] and comment
  const oldPattern = /^relationships:\s*\[\]\s*\r?\n(#[^\n]*\r?\n)?/m;
  content = content.replace(oldPattern, newRels + '\n');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('FIXED: ' + files[0] + ' (' + rels.length + ' rels)');
  count++;
}

console.log('\nTotal fixed: ' + count);

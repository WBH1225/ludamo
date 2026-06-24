// batch-add-opi-con-rels.js — 批量为15个OPI添加CON关系
const fs = require('fs');
const path = require('path');

const OPI_DIR = path.resolve(__dirname, '..', '02-内容单元库', 'OPI');

// Mapping: OPI id → [{type, target, note}]
const mapping = {
  'OPI-001': [
    {type: '解释', target: 'CON-020', note: '产品第一性是"自己的东西"的底层原理——供应链/产品=那第一块砖'},
    {type: '证明', target: 'CON-006', note: '没有自己的东西=你没有交换筹码——所有商业计划都是建立在零筹码上的泡沫'}
  ],
  'OPI-002': [
    {type: '证明', target: 'CON-020', note: '电商赚钱靠供应链=产品第一性的直接证明'},
    {type: '证明', target: 'CON-022', note: '供应链先于流量=渠道匹配律的电商版——品类决定销售方式'}
  ],
  'OPI-003': [
    {type: '证明', target: 'CON-017', note: '城市生活方式剥夺专注力=环境决定论的生活版——换容器比修自己更有效'}
  ],
  'OPI-006': [
    {type: '证明', target: 'CON-005', note: '数据验证替代讨论=证伪思维的操作版——一个可证伪动作>一万句解释'}
  ],
  'OPI-007': [
    {type: '证明', target: 'CON-007', note: '正反馈是深耕信号=阶段复利——每一阶段的反馈是指南针不是终点站'},
    {type: '证明', target: 'CON-025', note: '深耕优于换道=赛道选择律——正反馈告诉你"这里值得深耕"'}
  ],
  'OPI-010': [
    {type: '证明', target: 'CON-003', note: '价值观筛选>管理=人力漏斗的上游——漏斗入口由创始人价值观决定'},
    {type: '证明', target: 'CON-006', note: '创始人价值观=交换的基准货币——吸引来的人用价值观跟你交换'}
  ],
  'OPI-011': [
    {type: '解释', target: 'CON-006', note: '资产价值=产出能力=价值交换的资产版——资产的价值不在自身在能换什么'}
  ],
  'OPI-012': [
    {type: '证明', target: 'CON-021', note: '赚到钱≠懂赚钱=需求溯源——钱是需求信号，抄对了≠理解了需求'}
  ],
  'OPI-013': [
    {type: '证明', target: 'CON-013', note: '驱动力=对标≠找回自己=牛马道vs修罗道的驱动力版——对标是修罗道的起点'}
  ],
  'OPI-014': [
    {type: '证明', target: 'CON-012', note: 'OPI-014是CON-012(情不立事)的观点表达——同一原则的观点版和概念版'}
  ],
  'OPI-015': [
    {type: '证明', target: 'CON-013', note: '你是懒不是迷茫=牛马道的反面——承认自己在牛马道是逃离的第一步'}
  ],
  'OPI-016': [
    {type: '证明', target: 'CON-006', note: '老板撤退=价值交换的信号——当交换不再对你有利，对方先撤退'},
    {type: '证明', target: 'CON-016', note: '老板撤退信号=瓶颈定位的外部指示器——别人撤退的地方就是瓶颈所在'}
  ],
  'OPI-017': [
    {type: '证明', target: 'CON-021', note: '钱是需求副产品=需求溯源——钱只是需求被满足后的信号，盯着钱=盯着影子'}
  ],
  'OPI-019': [
    {type: '证明', target: 'CON-010', note: '不合群=被排斥=人设边界的反面——别人定义了你是谁'},
    {type: '证明', target: 'CON-017', note: '不合群=环境决定论的社交版——是容器错了不是你错了'}
  ],
  'OPI-020': [
    {type: '证明', target: 'CON-010', note: '你是大股东=人设边界的权力版——你对自己有100%股权，别人最多是散户'}
  ],
};

let edited = 0;
let skipped = 0;

for (const [opiId, newRels] of Object.entries(mapping)) {
  // Find the file
  const files = fs.readdirSync(OPI_DIR).filter(f => f.startsWith(opiId + '_') && f.endsWith('.md'));
  if (files.length === 0) {
    console.log(`  ❌ ${opiId}: file not found`);
    skipped++;
    continue;
  }

  const filePath = path.join(OPI_DIR, files[0]);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Check if file already has relationships block
  const relsMatch = content.match(/^relationships:\s*\n/m);
  const yamlRels = [];

  if (relsMatch) {
    // Has existing relationships — add new ones before the closing ---
    // Find existing relationships entries
    const relsStart = content.indexOf('relationships:');
    const fmEnd = content.indexOf('---', relsStart);
    const relsBlock = content.substring(relsStart, fmEnd);

    // Check for existing CON relationships
    const existingCons = relsBlock.match(/target:\s*(CON-\d+)/g);
    const existingConSet = new Set(existingCons ? existingCons.map(m => m.replace('target: ', '').trim()) : []);

    // Filter out already-existing relationships
    const toAdd = newRels.filter(r => !existingConSet.has(r.target));

    if (toAdd.length === 0) {
      console.log(`  ⏭️ ${opiId}: all CON relationships already exist`);
      skipped++;
      continue;
    }

    // Build YAML entries for new relationships
    const newEntries = toAdd.map(r =>
      `  - type: ${r.type}\n    target: ${r.target}\n    note: ${r.note}`
    ).join('\n');

    // Insert before the closing --- of frontmatter
    const insertPoint = fmEnd;
    const beforeInsert = content.substring(0, insertPoint);
    const afterInsert = content.substring(insertPoint);

    content = beforeInsert + '\n' + newEntries + '\n' + afterInsert;
    console.log(`  ✅ ${opiId}: added ${toAdd.length} CON relationship(s) → ${toAdd.map(r=>r.target).join(', ')}`);
    edited++;
  } else {
    // No relationships block — create one before ---
    const fmEndMatch = content.match(/^---\r?\n([\s\S]*?)(\r?\n---)/);
    if (!fmEndMatch) {
      console.log(`  ❌ ${opiId}: cannot parse frontmatter`);
      skipped++;
      continue;
    }

    // Build full relationships block
    const newEntries = newRels.map(r =>
      `  - type: ${r.type}\n    target: ${r.target}\n    note: ${r.note}`
    ).join('\n');
    const relsBlock = `relationships:\n${newEntries}`;

    // Insert before closing ---
    const insertPoint = content.lastIndexOf('---', content.indexOf('---') + 3);
    content = content.substring(0, insertPoint) + relsBlock + '\n' + content.substring(insertPoint);
    console.log(`  ✅ ${opiId}: created relationships block with ${newRels.length} CON(s) → ${newRels.map(r=>r.target).join(', ')}`);
    edited++;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

console.log(`\n完成: ${edited} 编辑, ${skipped} 跳过`);

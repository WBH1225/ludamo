# CLAUDE.md — Claude Code 侧说明

## 项目概述

鲁大魔 Obsidian 内容结构化系统。从 904 条连麦对话分析中抽取可复用、可追溯、可重组的最小语义对象，建立跨单元的关系网络。

## 工作目录

`E:\鲁大魔思维知识库\鲁大魔Obsidian\`

## 关键约定

- 原始素材（`01-原始素材区/完整副本/`）只读，永不可改
- 内容单元 ID 格式：`{TYPE}-{NNN}`（QST/CON/OPI/CAS/SOL）
- 关系类型：回应/解释/证明/冲突
- 去重类型：完全重复/同义重复/近似重复/重复讲述
- Obsidian 兼容：正文引用用 `[[文件名]]`，frontmatter 保留结构化 ID

## 常用命令

- `node 07-脚本与工具/generate-source-registry.js` — 生成来源注册候选
- `node 07-脚本与工具/rebuild-processing-ledger.js` — 重建待处理清单
- `node 07-脚本与工具/extract-sample-units.js` — 从样本抽取内容单元
- `node 07-脚本与工具/generate-link-map.js` — 生成关系索引
- `node 07-脚本与工具/generate-duplicate-candidates.js` — 生成去重候选
- `node 07-脚本与工具/fill-obsidian-links.js` — 补全 Obsidian 双链
- `node 07-脚本与工具/summarize-system.js` — 系统总览

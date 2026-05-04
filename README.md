# Generative Serious Game

基于故事设定与 [`NodeStructure`](./NodeStructure/) 节点模板，自动规划全书与章节结构，生成文字冒险节点与选择性场景图的原型项目。前端负责配置与游玩预览，本地服务转发 OpenAI 兼容接口，避免浏览器直连官方 API 时的 CORS 问题。

## 功能概览

- **全书层**：从 `NodeStructure/1.txt`～`5.txt` 中选一整套作为「章图」；每个模板节点对应一章，章与章之间的衔接由 `bookEdges` 描述。
- **章节层**：每一章再选一整套模板作为「章内节点图」，生成旁白、对白与选项；出口节点的选项可跳转到下一章（`nextChapterIndex`）。
- **圣经**：首阶段生成人物与场景的稳定锚点（文本），后续扩写与生成都引用这些 `id`，减少漂移。
- **风格**：`visualStyle` 在全书确定一次；生图时与场景锚点、角色外貌、节点「瞬间动作」一起组拼成最终英文 prompt。
- **选择性生图**：仅对 `imageImportant` 的节点排队请求图像；无图节点使用略长的叙事与对白。
- **代理**：`/api/chat` → `…/v1/chat/completions`，`/api/images` → `…/v1/images/generations`；见官方 [Image generation](https://platform.openai.com/docs/guides/image-generation) 与兼容网关文档（例如 [API 快速开始指南](https://s.apifox.cn/0cc9d8a3-2430-47aa-bf45-98c5e07f58cf/doc-5745017)）。

## 环境要求

- [Node.js](https://nodejs.org/) 18+（建议当前 LTS）

## 安装与开发

```bash
npm install
npm run dev
```

开发时会同时启动：

- 后端：`http://127.0.0.1:8787`（API 代理）
- 前端：`http://127.0.0.1:5173`（Vite，已将 `/api` 代理到上述端口）

生产构建仅打包前端；若仍需代理，可先 `npm run build`，再用 `npm start` 在同一仓库中启动已有 `server`（或自行部署静态 `client/dist` 与代理服务）。

## 使用说明（界面）

1. **接口与模型**：选择 OpenAI 官方、`https://xuedingmao.top/v1` 类中转，或自定义 Base URL；填写 API Key；选择对话模型（如 `gpt-5.1`）与图像模型（`gpt-image-1` / `gpt-image-1.5` / `gpt-image-2`）。可用「测试对话」验证。
2. **故事与生成**：输入故事设定 → **规划全书**（圣经 + `visualStyle` + 章图 + `bookEdges`）→ 可选 **扩写大纲** → **一键生成所有章节**（文本完成后对重要节点并发生图）。
3. **游玩**：从第 1 章入口节点开始；有图节点显示图与短文案，无图节点为较长文案；章末选项可进入下一章。

## 项目结构

```
GenerativeSeriousGame/
├── client/           # React + Vite + TypeScript 前端
├── server/           # Express：代理 chat/images，读取 NodeStructure
├── NodeStructure/    # 全书/章节可用的五套结构模板（只借拓扑，示例剧情勿复用）
├── package.json      # workspaces：client、server
└── README.md
```

## 安全提示

API Key 通过浏览器发送至本机代理并转发至你配置的基址。请勿在公共网络或不受信设备上保存密钥；生产环境建议改为仅后端持有密钥或短期令牌。

## 许可

仓库内未附带许可证文件时，默认保留所有权利；如需开源请自行补充 `LICENSE`。

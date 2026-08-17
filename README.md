# DeepSeek Harness for VS Code

一个 VS Code 扩展，把 [DeepSeek Harness (DSH)](https://www.npmjs.com/search?q=%40deepseek-ai) Agent 运行时嵌入侧边栏聊天视图——不离开编辑器即可与 DeepSeek 模型对话，具备完整的工作区感知、会话历史、工具调用可视化和交互式问答能力。

## 功能特性

- **与 DeepSeek-V4 模型对话** —— 流式回复、思考块（thinking）、逐条消息的 token 统计（输入 / 输出 / 推理 / 缓存命中）。
- **模型与推理力度选择器** —— 在 `deepseek-v4-flash` / `deepseek-v4-pro` 及不同推理力度之间切换；实时显示上下文窗口占用。
- **工作区感知** —— Agent 知道你打开的文件夹，可通过只读工具（`list_files`、`read_file`、`search_files`）查看项目。
- **会话历史** —— 每段对话都会以追加式 JSONL 日志持久化到 `~/.dsh/sessions/<项目>/`；在 ☰ 面板按工作区浏览和恢复历史会话。
- **交互式提问（`ask_user`）** —— 模型可以在一轮对话中途暂停，以内联卡片向你提问（选项按钮 + 自由文本）；你的回答会成为工具结果，对话继续。
- **Markdown 渲染** —— 助手消息渲染 GFM：表格、代码块、列表、标题。
- **工具调用卡片** —— 每次工具调用内联展示参数与结果（运行中 / 完成 / 失败状态）。
- **用户插件** —— 把自己的 Cordis 插件放进 `~/.dsh/plugins/`，在 🧩 面板管理（见下文）。
- **凭据管理** —— 在 UI 中设置 DeepSeek API key；存储于 `~/.dsh/.credentials.yaml`（文件权限 0600），绝不经过 webview DOM。
- **Agent 模式** —— 开始对话时选择 Agent 模式（标准 / PTC / 极简 / 创造）；选择在会话创建时固化，之后不可更改。
- **会话统计条** —— 累计轮次 / 步数、LLM 与工具耗时、首 token 延迟、tok/s、缓存命中率、token 总量，实时更新，多行显示。

## 设置

提供方选项在 VS Code 设置页（**文件 → 首选项 → 设置**，搜索 "dsh"），不在侧边栏。所有设置在启动时读取一次——修改后请执行 **Developer: Reload Window**。

- `dsh.llm.baseURL` —— 自定义模型 API 端点（OpenAI 兼容的 `/chat/completions`），例如自托管网关 `http://localhost:3010`。留空使用官方 `https://api.deepseek.com`。
- `dsh.llm.defaultModel` —— 新会话默认使用的模型（默认 `deepseek-v4-flash`）。
- `dsh.llm.models` —— 选择器的自定义模型目录（在 `settings.json` 中编辑），例如 `[{ "id": "grok-4", "name": "Grok 4", "contextWindow": 256000 }]`。留空使用内置 DeepSeek 目录。

指向本地网关的 `settings.json` 示例：

```json
{
  "dsh.llm.baseURL": "http://localhost:3010",
  "dsh.llm.defaultModel": "grok-4",
  "dsh.llm.models": [{ "id": "grok-4", "name": "Grok 4", "contextWindow": 256000, "maxTokens": 8192 }]
}
```

通过 **Set API key** 设置的 API key 会用于 `dsh.llm.baseURL` 指定的任何端点。

## 架构

```
src/
  extension.ts        # 激活入口，注册侧边栏视图
  commands/           # “Open Chat”命令
  dsh-bridge/         # 宿主侧桥接层，架在 DSH 运行时（Cordis）之上
    boot.ts           #   挂载 DSH 核心服务（llm、agents、sessions、
                      #   tools、persistence、credentials）+ ask_user + 插件
    agents.ts         #   收件箱推送 / 轮次取消
    events.ts         #   session/event → webview 事件翻译（批量）
    history.ts        #   按项目的历史列表 + 对话记录重建
    models.ts         #   模型目录 + 选择
    credentials.ts    #   API key 存储
    workspace.ts      #   工作区提示词段落 + 只读工具
    ask-user.ts       #   ask_user 工具（挂起 Promise 式问答）
    plugins.ts        #   用户插件目录加载器
  webview-host/       # 路由（webview ⇄ 宿主协议）+ 视图提供者
  shared/protocol.ts  # 带版本号的线缆协议（v1）
  ui/                 # React webview（Vite），zustand 状态库
```

DSH 运行时是一个 [Cordis](https://github.com/koishijs/cordis) 插件系统：每项能力（LLM 路由、Agent 循环、工具、持久化）都是挂载在共享上下文上的插件。本扩展在 `boot.ts` 中组合它们，通过 `ctx.agents` 驱动 Agent，并把会话事件流式回传给 webview。

## 用户插件

`~/.dsh/plugins/` 下的任何条目——`.js` / `.mjs` / `.cjs` 文件，或含 `package.json` 的文件夹——都会在启动时被导入并挂载为 Cordis 插件。插件在所有核心服务**之后**加载，因此可以注入 `llm`、`agents`、`sessions`、`tools`、`systemPrompt`、`credentials` 等服务。

示例 `~/.dsh/plugins/hello.js`：

```js
// Cordis 插件：接收根上下文的函数。
module.exports = function helloPlugin(ctx) {
  // 例如：记录每一次工具调用
  ctx.on("session/event", (session, event) => {
    if (event.type === "tool/call") console.log("tool call:", event.data.name);
  });
};
```

导入或挂载失败的插件会被隔离：在 🧩 面板中显示为 `error`，不会影响其余启动流程。修改后执行 **Developer: Reload Window** 生效。

## 开发

```bash
pnpm install
pnpm build            # 宿主 bundle（esbuild）+ webview bundle（vite）
pnpm watch:host       # 宿主增量构建
pnpm watch:webview    # webview 的 vite dev

pnpm test:unit        # 单元测试（node）
pnpm test:webview     # 整应用 jsdom 冒烟测试
pnpm test:integration # vscode-test 集成测试
pnpm lint
```

在 VS Code 中按 `F5` 启动扩展开发宿主（Extension Development Host）。

## 说明

- 会话日志、凭据、插件都存放在 `$DSH_HOME`（默认 `~/.dsh`）下。
- webview 与宿主之间的线缆协议带版本号（`v: 1`），见 `src/shared/protocol.ts`。
- `koffi` 作为外部依赖运行（不打包进 bundle），以便其原生模块 `@koromix/koffi-<平台>` 能从真实安装位置解析——Windows 上的会话日志持久化依赖它。

# AI圆桌lite

- 产品名 AI圆桌lite；Chrome MV3 侧栏，按已确认 Mock A。首批 DeepSeek、Kimi、豆包，全部复用网页账号，不走模型 API。
- `src/background.js` 管轮次与持久化；`src/content.js` 是按需注入的网页适配器；`src/core.js` 是可单测的状态与 prompt 逻辑；`src/sidepanel.*` 是唯一 UI。
- 严禁改网页 MAIN world、全局定时器、rAF、可见性或焦点；不加 debugger、DNR、远程代码、PPT、token 仪表盘。
- 只向用户选中的网页注入。发送不确定时不能自动重发；必须区分重试发送、重新提取与用户确认完成。禁止静默截断正文和上下文。
- 初始仓库引导提交完成后启用 project-prep 钩子。后续主目录只做审查合并；任务使用独立 worktree 与独立 npm ci，禁止依赖 junction。读 `.agents/AUTHOR.md`、`.agents/MERGER.md`、`.agents/TESTING.md`。
- 全部离线合并检查：`npm run check`；真实网站实测另用 `npm run browser:live`，登录由用户完成。fixture 通过不代表真实网站通过。
- 不关闭用户浏览器或生产 AI Hub；浏览器 Profile 在 C:\VibeData\BrowserProfiles\AI-Yuanzhuo-Lite，测试浏览器只使用自身记录的 PID/端口。
- 测试输出放 artifacts/，文件名带日期与席位。不得提交 Profile、Cookie、登录截图、用户对话或 .env。
- AGENTS.md、CLAUDE.md、GEMINI.md 保持一致。版本只在明确发布时修改，普通合并不自动发布。

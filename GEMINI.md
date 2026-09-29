# AI圆桌lite

- 产品名 AI圆桌lite；Chrome MV3。每个窗口一场圆桌，主 Tab 阅读、侧栏操作。A 单篇精读（默认）、B 双篇对读、C 回答索引共用完整轮次记录，阅读偏好持久化。成员可选 DeepSeek、Kimi、豆包、千问、元宝、ChatGPT、Claude、Gemini、Grok，每场 2–3 位，全部复用网页账号，不走模型 API。
- `src/background.js` 管轮次与持久化；`src/workspaces.js` 管窗口归属；`src/content.js` 是按需注入的网页适配器；`src/core.js` 是可单测的状态与 prompt 逻辑；`src/main.html` 与 `src/sidepanel.html` 复用 `src/sidepanel.js` 和样式。
- 时光机按原提问时间回看。历史选择不改变下一轮基准；旧内容须显式引用。主界面只有阅读动作，侧栏关闭后主 Tab 提供同一草稿的操作区。草稿 revision、恢复备份、窗口关闭/重开和跨窗口隔离属于必要回归。
- 用户已批准复用旧 AI-Arena 的后台调试方案。仅对本轮绑定标签页按请求使用 chrome.debugger 的生命周期唤醒和焦点模拟，启用失败必须明确报错；完成、停止、异常或离开站点后释放，恢复原 autoDiscardable 值。禁止扫描并常驻接管无关网页。
- 不注入 MAIN world 补丁，不改写网页的全局定时器、rAF、visibility/hasFocus 属性；不加 DNR、远程代码、PPT、token 仪表盘。Chrome 原生 CDP 焦点模拟是上一条的明确例外。
- 只向用户选中的网页注入。发送不确定时不能自动重发；必须区分重试发送、重新提取与用户确认完成。禁止静默截断正文和上下文。
- 初始仓库引导提交完成后启用 project-prep 钩子。后续主目录只做审查合并；任务使用独立 worktree 与独立 npm ci，禁止依赖 junction。读 `.agents/AUTHOR.md`、`.agents/MERGER.md`、`.agents/TESTING.md`。
- 用户 Chrome 固定加载 `C:\VibeData\Extensions\AI-Yuanzhuo-Lite`；每次合并后 afterMerge 自动执行 `npm run install:local` 同步到该目录，扩展里出现“更新到新版本”，点一下原地重载，记录和窗口保留。这不是发布，不推送；版本号按下面的规则随交付抬升。
- 全部离线合并检查：`npm run check`；真实网站实测另用 `npm run browser:live`，登录由用户完成。fixture 通过不代表真实网站通过。
- 不关闭用户浏览器或生产 AI Hub；浏览器 Profile 在 C:\VibeData\BrowserProfiles\AI-Yuanzhuo-Lite，测试浏览器只使用自身记录的 PID/端口。
- 测试输出放 artifacts/，文件名带日期与席位。不得提交 Profile、Cookie、登录截图、用户对话或 .env。
- AGENTS.md、CLAUDE.md、GEMINI.md 保持一致。每次交付给用户的合并都抬版本号（任务分支同时改 src/manifest.json、package.json 与 package-lock.json；新功能升次版本、修复升修订号），界面显示版本；推送 GitHub 与对外发布仍需用户授权（2026-09-27 用户要求）。

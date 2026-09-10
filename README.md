# AI圆桌lite

按确认的 **Mock A：轻巧侧栏** 实现的 Chrome MV3 扩展。原 AI 网页保持在主区域，右侧集中显示多家回答。

首批成员：**DeepSeek / Kimi / 豆包**。本版本为 0.1.0 初步实现；2026-09-09 已使用登录后的三家真实网页完成同题、追问、讨论、重新提取和停止测试，并由豆包完成队长总结。详见 `docs/20260909-initial-verification-codex.md`。

上述为首版功能验证，不等于新增后台机制已完成三站验收。本次原生浏览器首轮 DeepSeek / Kimi 完成，豆包遇到验证码；实际进度与限制见 `docs/20260909-background-verification-codex.md` 和本地 artifacts 的实测记录。

## 使用

1. `npm ci`，然后 `npm run build`。
2. Chrome 扩展管理页开启开发者模式，加载解压的 `dist` 文件夹。
3. 点击扩展图标打开侧栏，点击“打开并连接三家网页”，分别完成网页登录。
4. 在圆桌中输入问题。每家一张状态卡片，点击展开全文。

一个圆桌为每家成员绑定独立标签页和对话 URL。新建圆桌保留历史；“原网页”返回该成员绑定的对话。

## 首版功能

- 同题并行回答、原文追问、独立迭代、观点讨论、指定队长总结。
- 观点讨论沿用 AI-Arena 自由辩论的主提示和轮次引导，每家仅收到其他成员上轮的完整回答；队长总结收齐全部有效回答。
- 逐成员状态、完整 Markdown / 代码、复制、重新提取、重试发送、跳过、停止。
- 会话持久化、轮次回看、完整 Markdown 导出、主动删除历史。
- 网页返回不确定时不会自动重复发送；长时间无结束证据时提示用户核对。
- 重新提取核对本轮提问身份；切换到其他网页对话时停止采集。历史轮次只能回看，不会覆盖成最新回答。
- 只向被选中的网页按需注入，完成后释放 Observer 和读取定时器。
- 后台提取复用旧 AI-Arena 的 Chrome 调试唤醒与焦点模拟。每轮开始时启用，结束/停止时释放，恢复网页原有回收设置；不自动切换到前台。

回答期间 Chrome 会显示调试提示条，这是本轮后台支持；取消提示或打开开发者工具可能中断该连接，圆桌会提示核对原网页并重新提取。启用失败会阻止该成员发送，保留失败原因，不静默退回缺少后台支持的模式。公司浏览器策略可能不允许 debugger 权限。

PPT、token 统计、主题库、全站调度补丁、DNR、远程脚本、API 模型调用均未引入。

原文超过 120,000 字符时整次请求明确拒绝，不截取部分发送。最多保留 30 场本地圆桌，达到上限需用户导出并主动清理。容量不足也会明确报错，不自动删除答案。

## 验证与真实浏览器

```powershell
npm run check
npm run browser:live
```

`check` 覆盖构建、全部源码语法、`tests/*.test.mjs`、真实 MV3 扩展加载的 `tests/extension.mjs` 和无默认焦点模拟的 `tests/native-background.mjs`。浏览器测试使用受控网页验证消息链路、完整性、恢复与资源释放，不能宣称真实站点已通过。

离线检查涵盖 29 项回归、10 组扩展链路及原生后台对照。长时后台受控检查可运行 `node tests/native-background.mjs --long-hidden`。真实网站测试另有记录；网页 UI 后续更新仍可能需要适配，公司网络、长会话的 CPU / 内存改善尚未量化。

`browser:live` 直接启动独立、可见的 Chromium，Playwright 仅以 `noDefaults: true` 附着，不为网页开启测试用焦点模拟或禁用后台节流。登录由用户在浏览器中完成；脚本不读取、导出或提交 Cookie。新 Profile 存放在 `C:\VibeData\BrowserProfiles\AI-Yuanzhuo-Lite\live-native`，此前的 `live` 原样保留。自动化调试端口仅绑定 127.0.0.1，端口和 PID 写到忽略的 artifacts；正式扩展使用 chrome.debugger，不要求以调试端口启动日常 Chrome。

浏览器会保留给人工登录和后续实测。重新构建后，先确认没有进行中的圆桌，再通过扩展管理页重新加载扩展并刷新已连接网页。

首版 Playwright 浏览器的非活动标签页报告可见，曾造成后台验收偏差，见 `docs/20260909-peer-prompts-verification-codex.md`。现在必须以原生隐藏页面为起点，验证由扩展自身启用调试后恢复更新、结束后恢复隐藏；这不构成系统休眠、断网、验证码或公司策略限制下的成功承诺。方案调研见 `docs/20260909-background-research-codex.md`。

## 开发流程

本仓库接入 project-prep v0.1.0。初次引导提交之后执行 `node scripts/setup-project.mjs` 启用钩子；后续实现使用独立 worktree 与独立 `npm ci`，不使用依赖 junction。

- `.agents/AUTHOR.md`：实现与自测。
- `.agents/MERGER.md`：独立审查及绑定完整 SHA 的合并。
- `.agents/TESTING.md`：离线与真实账号验收边界。

不要在启用钩子后的主工作目录开发。不要从生产 Chrome Profile 复制 Cookie，也不要对生产 AI Hub 做进程操作。

## 实现参考

- 经确认的 A 方案：原网页在中间，圆桌占右侧；展开卡片不切换主网页。
- 旧版 AI-Arena：参考三站 DOM 适配经验，沿用自由辩论的提示词、排除自身回答规则和 CDP 唤醒/焦点机制；未迁入其 MAIN world 调度补丁和完整模块。
- [Chrome sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [MV3 service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Playwright 扩展测试](https://playwright.dev/docs/chrome-extensions)

运行时第三方库只有 marked 与 DOMPurify，打包到本地并附许可证，不从 CDN 加载。

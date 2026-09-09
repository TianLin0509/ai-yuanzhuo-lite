# 讨论 prompt 修复与验证更正

2026-09-09，用户指出观点讨论不应把接收者自己的回答再次转发给自己。首版将所有回答拼成同一条 prompt，测试也错误地断言三家都收到全部回答。这是实现与验收规则的共同错误。

## 对齐旧版

参考旧 AI-Arena 提交 `961d922c64e36e80feb60c3a705ee5e635796896` 的 `src/debate-engine.js`（`buildDebatePrompt`）和 `src/templates-builtin.js`（`debate.free`）：

- 按接收者排除自身，只转发其他成员上一轮已完成的完整回答，不截断正文或代码。
- 保留旧版自由辩论主提示、第 1–3 轮提示和第 4 轮起的提示；用户补充要求保留原文并放在前面。
- DeepSeek 收 Kimi + 豆包，Kimi 收 DeepSeek + 豆包，豆包收 DeepSeek + Kimi。两人圆桌互换回答，失败文本不作为观点。
- 讨论轮数按本圆桌已有讨论计数。各 AI 已在其绑定的网页对话中保留自己的回答。
- 队长总结仍收齐全部有效回答，包括队长自己的回答。

## Author 验证

先改断言再改实现：原实现触发 3 个失败（错误转发自身回答）；修复后 core 9/9 通过。完整 `npm run check` 通过：19 项回归、10 组真实 MV3 加载的受控网页检查，浏览器部分 65,453 ms，结束后空闲资源为零。

回归包含三人逐接收者映射、长正文/代码原样保留、两人互换、连续四轮只取上一轮、失败回答排除、总结包含自身。扩展链路还检查网页实际接收的消息全文，每家只发送一次，且内容与对应任务 prompt 一致。

在用户已登录的独立 Chromium 148 中，新建专用测试圆桌，发送 `LITE-PEER-CHECK` 标记问题，再发起一次讨论。三家首轮和讨论均自动完成；逐一核对各网站实际用户消息：包含另外两家的完整正文、不含自己的回答区块及全文、匹配消息恰好一条，三家最终回答都包含结束标记。测试通过真实扩展消息入口发起，没有改写回答存储或手动确认完成。

本机原始证据在忽略的 artifacts：`20260909-lite-peer-prompts-live-evidence-codex.json`；复查脚本为 `20260909-peer-prompts-live-codex.mjs`。原始测试对话不进 Git。

## 后台验证边界

这次检查同时发现测试环境偏差：Chrome 的三家标签页均为 `active: false`，但页面原生 `document.visibilityState` 仍为 `visible`。Playwright 1.60.0 默认会设置焦点模拟；只移除禁用后台节流的启动参数，并不足以消除该影响。后续附着使用 `noDefaults: true`，尝试关闭新 CDP 连接的焦点模拟后，既有浏览器仍报告可见。

因此，上述三站结果只证明实际网站的功能链路和转发内容，不证明普通 Chrome 的真实隐藏页面在后台超过 5 分钟仍能连续完成，更不证明冻结或丢弃后的恢复。后台验收明确为 **未验证**。没有为制造通过而改写页面可见性，也没有重启用户已登录的浏览器。

后台页是否能采集取决于网站是否更新 DOM、浏览器是否允许页面任务继续运行、适配器是否正确识别本轮消息。Lite 减少了监听与轮询开销，没有引入绕过这些限制的新机制。普通 Chrome 的长时隐藏、窗口最小化、节能/内存回收及恢复需要另行验证。

诊断过程中，第一次脚本切换会话存在等待时序错误，一条带标记的测试问题进入了此前用户选中的圆桌。已告知用户，停止了那条测试剩余任务并保留记录；它不计入通过证据。后续测试显式绑定专用会话 ID。

参考：[Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)、[CDP focus emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled)、本机 Playwright `playwright-core/lib/coreBundle.js` 的 `Emulation.setFocusEmulationEnabled` 和 `types/types.d.ts` 的 `connectOverCDP` / `noDefaults`。

本文件为 Author 自测记录；独立 Merger 的审查、合并及 CI 结果另行给出。

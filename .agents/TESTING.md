# 验证边界

`npm run check` 是离线合并总入口，失败退出非零。它运行构建、每个 src/*.js 的语法检查、所有 tests/*.test.mjs 和 tests/extension.mjs。

- core.test.mjs：原文完整性、讨论材料、上下文超限拒绝、重复发起保护、迟到/乱序/跨标签页事件、合法平台、完整导出。
- extension.mjs：真正加载 MV3 扩展，用受控三站 HTML 验证 UI → service worker → 内容脚本 → 网页 DOM → 存储 → UI 的链路；检查资源释放和未选中网页零注入。
- fixture.mjs 是网页数据提供器，不是独立测试入口。
- background-support.test.mjs：Chrome 调试支持的请求归属、取消、失败传播、完整恢复日志与回收设置还原；清空 session 后的 local 日志恢复、target 身份变化、查询/落盘失败必须覆盖。background.test.mjs 还覆盖取消/停止与异步注入的发送边界竞态，以及旧任务恢复不得向复用 tabId 的新页面发送停止消息。
- captcha-recovery.test.mjs：豆包验证码后临时 URL 转正式会话的受限重读、Markdown 有序列表数字身份、DeepSeek 虚拟列表消息键、文档卡片不冒充完整答案、旧回答重新挂回与部分回答节点回收不得误判完成。
- native-background.mjs：原生 Chromium + noDefaults 附着，未启用时三家隐藏且受控 rAF 停止；由扩展自身启用后后台三家完整生成；结束恢复隐藏并释放调试连接，非成员对照页不受影响。

Playwright 在 Windows 优先使用已有 `C:\VibeData\BrowserCache\playwright`；其他环境按 Playwright 默认浏览器目录，需要先 `npx playwright install chromium`。

## 必须另做的真实验收

用户登录 DeepSeek / Kimi / 豆包后，逐站确认输入框、发送按钮、回答容器、完成信号和会话 URL。至少覆盖同题并行、第二轮追问、讨论、总结、单家重读、停止、长回答/代码、后台页和侧栏重开。人工登录未完成或其中某站未测时必须明确标注。

隔离 fixture 能证明程序内部行为，不能证明第三方网页当前兼容，也不能证明公司机器上的性能提升比例。

后台验收必须记录 Chrome 的标签页 active 状态以及页面原生 visibilityState / wasDiscarded，不能只凭标签未被选中就判定已测试隐藏页面。Playwright 的焦点模拟可能使非活动页面仍报告 visible；即使去掉禁用后台节流的启动参数，也不能据此宣称普通浏览器的后台可靠性通过。必须原生启动浏览器，后续 CDP 附着使用 noDefaults: true，避免添加测试工具的焦点模拟。仅当先证实原生 hidden，再由正式扩展自己的 chrome.debugger 变为 visible，且终止后恢复，才可证明本次获准的后台支持机制。不能在测试脚本额外发送 focus emulation 命令来帮助通过。

成员和非参与对照页均使用 Chrome 原生 `tabs.create({active:false})` 创建。实测即使 noDefaults 附着，Playwright `context.newPage()` 创建的页面也可能在扩展启用前保持 inactive / visible。必须在发送前就断言对照页 hidden、原生 rAF 不增长、没有扩展 debugger 所有权和产品脚本注入；记录 tabId / targetId，并在生成中及结束后继续检查。不能把漏验的可见对照页视作产品影响范围的证据。

`node tests/native-background.mjs --long-hidden` 提供 330 秒后台等待后的受控验证。真实三站后台、窗口最小化和调试取消恢复要另列结果；禁止把受控页面或短时测试推成真实三站长时通过。

Profile、用户对话、截图、日志在忽略的 artifacts 或 C:\VibeData；不进提交。只操作本次启动的浏览器，不终止生产 Hub，不复制个人 Cookie。

# 验证边界

`npm run check` 是离线合并总入口，失败退出非零。它运行构建、每个 src/*.js 的语法检查、所有 tests/*.test.mjs 和 tests/extension.mjs。

- core.test.mjs：原文完整性、讨论材料、上下文超限拒绝、重复发起保护、迟到/乱序/跨标签页事件、合法平台、完整导出。
- extension.mjs：真正加载 MV3 扩展，用受控三站 HTML 验证 UI → service worker → 内容脚本 → 网页 DOM → 存储 → UI 的链路；检查资源释放和未选中网页零注入。
- fixture.mjs 是网页数据提供器，不是独立测试入口。

Playwright 在 Windows 优先使用已有 `C:\VibeData\BrowserCache\playwright`；其他环境按 Playwright 默认浏览器目录，需要先 `npx playwright install chromium`。

## 必须另做的真实验收

用户登录 DeepSeek / Kimi / 豆包后，逐站确认输入框、发送按钮、回答容器、完成信号和会话 URL。至少覆盖同题并行、第二轮追问、讨论、总结、单家重读、停止、长回答/代码、后台页和侧栏重开。人工登录未完成或其中某站未测时必须明确标注。

隔离 fixture 能证明程序内部行为，不能证明第三方网页当前兼容，也不能证明公司机器上的性能提升比例。

后台验收必须记录 Chrome 的标签页 active 状态以及页面原生 visibilityState / wasDiscarded，不能只凭标签未被选中就判定已测试隐藏页面。Playwright 的焦点模拟可能使非活动页面仍报告 visible；即使去掉禁用后台节流的启动参数，也不能据此宣称普通浏览器的后台可靠性通过。后续 CDP 附着应使用 noDefaults: true 避免添加焦点模拟，但它不会撤销其他既有连接的模拟。无法建立真实隐藏条件时明确记为未验证，不用临时改写页面可见性来制造通过。

Profile、用户对话、截图、日志在忽略的 artifacts 或 C:\VibeData；不进提交。只操作本次启动的浏览器，不终止生产 Hub，不复制个人 Cookie。

# 后台标签页采集方案研究

## 决策

在 Chrome 扩展、DeepSeek / Kimi / 豆包网页版、复用网页登录、不部署额外常驻程序的范围内，采用旧 AI-Arena 的 **chrome.debugger + CDP 页面唤醒 / 焦点模拟 + 现有 DOM 提取**。没有找到能够在这些条件下同时减少权限、减少维护成本、并提供相同后台执行控制的更合适替代方案。这个结论是工程取舍，不是声称任何网站、Chrome 版本和网络条件都能百分之百成功。

新版按请求持有调试连接：发送或重新提取前启用，回答完整完成、失败、停止或离开对应网站后释放。只处理本轮绑定的标签页，保留完整回答、消息归属校验与讨论时排除自身的规则。旧版的 MAIN world、rAF、Worker 定时器、CSP/DNR 修改不迁入。

## 旧版方法的源码核验

源仓库 `C:\AIWork\20260909-ai-arena-extension`，只读核验提交 `961d922c64e36e80feb60c3a705ee5e635796896`，工作区保持干净。

`src/cdp-extractor.js:32-70` 的顺序是 attach → Page.enable → Page.setWebLifecycleState(active) → Emulation.setFocusEmulationEnabled(true) → setIdleOverride。Tab 布局通过 `src/background.js:575-597` 为参与者启用该机制；实际回答仍由 `src/chat-bus.js:731-737` 调用三家内容脚本读取 DOM。它不是监听三家 SSE 的实现，也不需要用户以远程调试端口重启 Chrome。

旧版 `src/chat-bus.js:636-641` 的每轮 attach/release 已是空操作，实际调试连接与整个 Tab 会话绑定。启动扫描还可能接管所有匹配的 AI 网页。与此同时，manifest 的 MAIN world 脚本仍无条件注入，永久改写 rAF、定时器、可见性及焦点。因此，旧版能后台提取与旧版存在较大调度开销可以同时成立；源码不能证明公司机器卡顿的全部原因。

旧实现存在需要修正的边界：核心焦点命令失败只警告却返回成功；用户取消调试后只删除内存记录；并发 attach 没有统一串行；detach 异常被吞掉。商店构建还会移除 debugger 权限，GitHub 构建与商店包不能混为一谈。历史后台测试仍有 Playwright 默认模拟因素，不能直接继承为当前三站验收。

## 机制为何有效

Chrome 官方将焦点模拟定义为模拟 focused / active page，并明确它会令 document.visibilityState 为 visible、不再触发正常 visibilitychange。它解决的是网站前端因为处于后台而停止渲染或更新的问题，不是让 DOM 选择器突然具备跨页面能力。[1][2]

Page.setWebLifecycleState(active) 用于恢复冻结的页面生命周期；它不是把真实标签页切到前台，也不应在释放时反向设置 frozen。[3] Chrome 118 起，扩展创建的活动 debugger 连接同时保持扩展 service worker 存活；这有助于长回答的编排，但不等于保证外部服务器或操作系统持续运行。[4]

tabs.autoDiscardable=false 只阻止自动回收，不足以独立解决隐藏页面的执行节流。Chrome 132 新增 frozen 状态可观察性，也不是不受限制的后台执行授权。[5] 因此防回收只作本轮辅助，保存原值并在结束后恢复。

## 候选方案比较

| 方案 | 优点 | 关键不足 | 结论 |
| --- | --- | --- | --- |
| 仅 DOM Observer / 定时读取 | 权限少、实现小 | 网站不更新 DOM 时无新回答可读；冻结后定时任务也停止 | 保留为提取层，不单独承担后台保证 |
| 仅 autoDiscardable / 内存节省白名单 | 降低被回收概率 | 不解决隐藏页面的渲染与定时器节流 | 作为辅助 |
| 按请求 CDP 唤醒 + 焦点模拟 + DOM | 复用旧方案与当前三站适配，控制范围可限于三个标签页 | debugger 权限与提示条；被用户/DevTools断开或公司策略拒绝时必须处理 | 本次采用 |
| CDP Network 响应流提取 | 可减少对网页渲染和 DOM 的依赖，适合未来长正文兜底 | 仍要 debugger；流、补丁、消息ID、思考/正文边界需逐站解码；不是三家统一文本接口 | 后续有明确 DOM 完整性问题时再做限定站点实验 |
| webRequest / DNR | 可观察请求元信息或修改请求规则 | webRequest 事件并不提供通用响应正文流；DNR不是回答解析器 | 不能替代提取链 |
| offscreen document | 扩展可在隐藏文档使用 DOM API | 文档须为扩展打包的静态页面，不能自动令另外三个网页继续渲染 | 不采用 |
| 轮流激活三个标签页 | 容易让前台网页恢复更新 | 会抢用户当前页面与焦点；并非稳定三路后台并行 | 仅保留用户主动“原网页”恢复 |
| MAIN / Worker / rAF 全局补丁 | 可以绕过部分网站自行暂停逻辑 | 改变原站调度与事件语义，驻留范围广，兼容与性能风险难收敛 | 不迁入 Lite |
| 本地 CDP 常驻助手 / APP / 官方模型 API | 可得到更完整的执行环境或结构化响应 | 增加安装维护或改变网页版账号/产品约束；API模型与订阅并非同一接入 | 不作为本次 Chrome 插件的默认方案 |

CDP Network.streamResourceContent 能把指定 requestId 后续响应字节放入 dataReceived，并返回已缓存字节；它目前在协议中标为 Experimental。[6] 这证明网络直采值得针对性研究，却不能证明三家协议已经稳定适配，更不能消除尚未发起网络请求、验证码或网络中断的问题。

## Lite 实现约束

1. 先保存待管理 tab 与请求身份、原 autoDiscardable 值，再启用支持；关键 CDP 命令失败时阻止该成员越过发送边界，显示原始失败原因，不静默降级。
2. 同一 tab 同时只允许一个请求持有支持。停止发生在 attach 期间时，attach 返回后重新检查请求状态并释放；旧轮次不能释放新请求的连接。
3. 完成和停止都 detach，并恢复原回收设置；不设置 frozen，不改站点原生 API，不读取 Cookie，不拦截网站请求。
4. 取消调试提示、关闭标签页或导航离开 AI 网站后，将受影响请求标记为需要处理，保留已收到正文；不自动重发或重新抢占调试连接。
5. 用 session storage 记录资源归属。扩展异常重启后先清理上一运行期残留，再由用户重新提取。释放失败明确显示并通过现有恢复检查重试清理。
6. 不迁入旧版 idle override。现有证据没有证明三家聊天前端需要模拟“用户活动/屏幕未锁定”；仅保留已证实相关的生命周期与焦点控制。

## 验收方法与边界

必须使用原生启动的独立 Chromium，不添加禁用后台节流参数；Playwright 只通过 noDefaults:true 附着。先记录三家 tab active:false、页面 hidden；生成时由扩展自身 attach 使它们 visible，非参与者对照页仍 hidden；结束后检查恢复 hidden、attachment=0、原 autoDiscardable 恢复以及内容读取资源为零。测试工具不得另行发 focus emulation 命令来帮助通过。

功能覆盖三家同题、追问、讨论的两家互评材料、完整正文/代码/结束标记、重读不重发与停止。额外验证长时后台等待后启动、窗口最小化、调试连接中断、关键命令失败、迟到请求与释放恢复。受控页面只能证明内部行为，真实账号结果单列。

公司设备可能通过扩展 host 限制、截图/DLP策略等拒绝 debugger.attach；Chrome 官方列出了这些拒绝条件。[7] 实现应显示策略拒绝并停止，不提供绕过公司策略的操作。网络不可达、登录失效、验证码、网站修改、操作系统休眠仍属于外部条件；缺失任何一家时不得把整轮报成完整成功。

实测结果和独立审查报告记录在项目 artifacts；未完成的测试不得从本设计文字推断为已通过。

## 来源

1. Chrome DevTools，Apply other effects / Emulate a focused page，访问 2026-09-09：https://developer.chrome.com/docs/devtools/rendering/apply-effects#emulate_a_focused_page
2. Chrome DevTools Protocol，Emulation.setFocusEmulationEnabled（Experimental），访问 2026-09-09：https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled
3. Chrome DevTools Protocol，Page.setWebLifecycleState，访问 2026-09-09：https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setWebLifecycleState
4. Chrome for Developers，The extension service worker lifecycle / Chrome 118，访问 2026-09-09：https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
5. Chrome for Developers，chrome.tabs，访问 2026-09-09：https://developer.chrome.com/docs/extensions/reference/api/tabs
6. Chrome DevTools Protocol，Network.streamResourceContent，访问 2026-09-09：https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-streamResourceContent
7. Chrome for Developers，chrome.debugger（页面更新 2026-09-03），访问 2026-09-09：https://developer.chrome.com/docs/extensions/reference/api/debugger
8. Chrome for Developers，chrome.offscreen，访问 2026-09-09：https://developer.chrome.com/docs/extensions/reference/api/offscreen
9. Chrome for Developers，chrome.webRequest，访问 2026-09-09：https://developer.chrome.com/docs/extensions/reference/api/webRequest
10. Chrome for Developers，Heavy throttling of chained JS timers beginning in Chrome 88（2021），机制背景，不视为所有当前设备的固定时间承诺：https://developer.chrome.com/blog/timer-throttling-in-chrome-88/
11. 旧 AI-Arena 本机源码：上述完整提交的 cdp-extractor.js、background.js、chat-bus.js、bootstrap-main-world.js、manifest.json、build.mjs；只读访问 2026-09-09。

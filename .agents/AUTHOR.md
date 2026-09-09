# Author：实现与自测

先读 AGENTS.md、project.json 和 TESTING.md。其他 Agent 可能同时工作，保留他人的编辑。

1. 记录当前 main 的完整 SHA；从 main 创建 `../ai-yuanzhuo-lite-worktrees/YYYYMMDD-task-seat` 与 `task/YYYYMMDD-task-seat` 分支。
2. 该 worktree 执行独立 npm ci。不得创建 node_modules junction，不修改主目录业务文件。
3. 聚焦获准需求。开发用 npm test，交付前 npm run check。涉及站点 DOM 的改动还需单独进行用户授权的真实网页验证。
4. 不用模拟页面冒充真实站点验收。不把发送超时当成功，不自动重发不确定请求，不丢弃完整正文。
5. 只暂存本任务文件，交付候选完整 SHA、基准主干 SHA 与验证证据。不自行合并，不设置 PROJECT_PREP_ALLOW_COMMIT/PUSH。
6. 交独立 Merger 审查；主干推进后由 Author rebase 并重测。

初次仓库引导提交在钩子启用前进行。正常开发不自动发布版本、推送受保护分支或发布扩展。

```text
PROGRESS: 完成内容、任务分支和完整 SHA
VERIFIED: 实际命令、结果与耗时
RISK: 已知问题和未验证边界
REPORT: 证据文件的绝对路径
```

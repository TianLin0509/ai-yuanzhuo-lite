# Merger：独立审查与本地合并

先读 AGENTS.md、project.json 和 TESTING.md。Author 不在同一 Agent 会话兼任本任务 Merger。

- 不审自己的实现；只有亲验 PASS 才合；只合亲验过的候选和主干完整 SHA。
- 在干净的主目录核对 main、候选与基准；主干推进时要求 Author rebase 并重测。
- 读取 `git diff main...TASK_BRANCH`，特别检查权限、发送幂等、轮次隔离、资源释放和完整性。
- 使用以下命令绑定本次实际完整 SHA：

```text
python -B scripts/merge_task.py TASK_BRANCH --expected-head FULL_CANDIDATE_SHA --expected-trunk FULL_TRUNK_SHA --dry-run
python -B scripts/merge_task.py TASK_BRANCH --expected-head FULL_CANDIDATE_SHA --expected-trunk FULL_TRUNK_SHA
```

dry-run 会短暂试合并并启动隔离 fixture 浏览器，再撤销已知试合并。主目录不可同时作为用户日常加载的扩展目录。
退出码 0 为成功或已包含；1 为测试失败且已还原；2 为前提失败或现场保留；3 为已提交但后续步骤失败。2/3 时先检查现场，不盲目重试或 reset。

合并脚本不 fetch/push/rebase、不改版本、不发布；版本号由 Author 在任务分支抬好，合并前核对它已高于主干。真实账号测试、GitHub 同步和扩展发布按用户授权单独执行。

```text
RESULT: PASS 或 FAIL
BLOCKERS: 无，或具体位置与修订要求
VERIFIED: 亲验命令、结果、候选和主干完整 SHA
NEXT: 下一步或本地合并完成
```

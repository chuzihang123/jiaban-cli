---
name: jiaban-cli
description: 使用内部测试专用 jiaban CLI 管理加密测试环境 profile，并按明确 ID 查询家办系统。禁止正式环境和对外使用。
---

# Jiaban CLI

仅在用户明确要求内部测试，并且查询范围与当前会话授权一致时使用。正式环境永不调用本 CLI。

## 前置条件

- 宿主必须能够执行 `jiaban` 命令。
- 地址、账号、密码优先由 Agent 部署 Secret 注入，严禁让用户在聊天中发送这些值。
- 仅使用专用测试账号；严禁个人账号和正式环境账号。
- 自动登录 Token 只保留在当前 CLI 进程；不询问、展示、复制或记录 Token。
- 本技能不会授予任何权限，后端仍按会话的角色与数据范围鉴权。

## 允许的命令

```text
jiaban health
jiaban auth status
jiaban customer get --id <正整数客户ID>
jiaban contract list --customer-id <正整数客户ID>
jiaban contract status --id <正整数流程ID>
jiaban profile save <name>       # stdin 单个 JSON，禁止 password flag
jiaban profile use <name>
jiaban profile current
jiaban profile list
jiaban profile remove <name>
```

不得拼接或尝试其他子命令。尤其禁止任意 HTTP/API 命令、登录、创建、修改、审批、上传和删除操作。

## 调用规则

1. 用户说“保存测试环境 X”时，仅在私聊且用户明确接受聊天留存密码风险后，将单个 `{baseUrl,phone,password}` JSON 通过 stdin 交给 `profile save X`；不得把 password 放进命令参数。
2. 用户说“切换到 test-a”时，可以执行 `profile use test-a`，但必须提醒 active profile 是单宿主全局状态，会影响其他聊天。
3. 更安全的对话隔离方式：在该对话后续每一次业务调用都显式添加 `--profile test-a`。CLI 不会为对话保存临时选择；新对话不能继承聊天语义。
4. “当前环境”映射 `profile current`；“环境列表”映射 `profile list`；“删除环境”映射 `profile remove <name>`。列表只返回名称和 active，不尝试获取 URL/账号。
5. 查询客户时只使用用户明确给出的客户 ID；没有 ID 时停止并请用户提供，不得先下载客户列表或按手机号扫描。
6. 不扩大查询范围。用户只问一个客户或流程时，不要汇总其他客户数据。命令必须串行执行。
7. 每次只执行完成当前问题所需的最少命令。
8. stdout 是单个 JSON 对象。仅当 `ok` 为 `true` 时使用 `data`；`ok` 为 `false` 时读取 `error.code` 与脱敏后的 `error.message`。
9. 退出码 `4` 表示认证或授权失败，应停止并检查专用测试账号；不得改用个人账号。
10. `TIMEOUT` 或 `NETWORK_ERROR` 仅可在用户仍等待且操作安全时重试一次；其他错误不要自动重试。
11. 回复飞书群聊时保持数据最小化。手机号已经掩码，仍不要转发与问题无关的数据。

## 结果表达

- 健康检查只说明服务进程是否响应，不推断数据库或其他依赖一定健康。
- 客户查询未找到时，直接说明未找到，不搜索其他客户，也不猜测客户身份。
- 合同状态以 `status`、`currentFlowNodeName` 和 `processActive` 为准；不根据缺失字段自行推断审批结论。
- 不向用户输出原始 JSON，除非用户明确要求机器可读结果。

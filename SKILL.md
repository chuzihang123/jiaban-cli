---
name: jiaban-cli
description: 使用内部隔离测试专用 Jiaban CLI 管理加密 Profile、执行最小领域查询，并在双重开关和 dry-run 审核下构造受控 HTTP API 请求。禁止生产和对外使用。
---

# Jiaban CLI

仅在用户当前回合明确要求内部隔离测试，且范围与当前会话授权一致时使用。公开仓库只提供固定版本安装包，不代表允许生产使用。本 Skill 不授予权限；后端角色、租户和数据范围始终生效。

## 前置条件

- 宿主可以执行 `jiaban`，版本为 0.2.0。
- 只使用专用测试账号和测试数据，永不使用个人账号、正式账号或生产环境。
- 地址与凭据由部署 Secret 或加密 Profile 提供；不询问、展示、复制或记录 Token/密码。
- 登录角色可来自 Profile `activeRole` 或 `JIABAN_ACTIVE_ROLE`；Profile 整组优先，旧 Profile 默认 `SENIOR_ADMIN`。只允许文档列出的角色白名单。
- 自动登录 Token 仅保留在当前进程。
- 所有命令串行执行，每次业务调用显式带 `--profile <name>`；不依赖宿主全局 active profile。
- 通用请求要求 `JIABAN_CLI_FULL_ACCESS_ENABLED=true`；DELETE 或高危路径还要求 `JIABAN_CLI_DESTRUCTIVE_ENABLED=true`。
- 文件请求要求预先配置绝对路径 `JIABAN_CLI_UPLOAD_ROOT`、`JIABAN_CLI_DOWNLOAD_ROOT`。

## 优先使用最小领域命令

```text
jiaban --profile <name> health
jiaban --profile <name> auth status
jiaban --profile <name> customer get --id <正整数客户ID>
jiaban --profile <name> contract list --customer-id <正整数客户ID>
jiaban --profile <name> contract status --id <正整数流程ID>
jiaban profile save <name>       # stdin 单个 JSON，禁止 password flag
jiaban profile use <name>
jiaban profile current
jiaban profile list
jiaban profile remove <name>
```

能由最小领域命令完成时，不使用 `api request`。查询客户或流程只使用用户明确提供的 ID；没有 ID 时停止并请求该 ID，不扫描或枚举其他客户。

## 高级 api request

```text
jiaban --profile <name> api request <METHOD> <PATH> [options]
```

允许 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`。禁止 WebSocket、`CONNECT`、`TRACE`、`OPTIONS`。PATH 必须是 `/api/` 开头的安全相对路径；query 只通过 `--query key=value` 传入。认证 Header 由 CLI 注入，禁止用户提供 Token、Cookie、Host、代理/转发 Header 或 CR/LF。

请求体按需选择且互斥：`--json-stdin`、`--json-file <绝对路径>`、`--body-file ... --content-type ...`、`--form`、`--multipart` 配合 `--form/--json-part/--upload`。上传语法为 `field=绝对路径`，按安全扩展名推断 MIME；严格端点可用 `field=绝对路径;type=application/pdf` 显式指定安全 MIME，重复 field 可用。JSON 正文必须来自 stdin 或受控文件，不放在命令行。GET/HEAD 不带 body。下载使用绝对 `--output`，覆盖普通文件必须显式 `--overwrite`。上传/请求体文件不得越过 `JIABAN_CLI_UPLOAD_ROOT`，下载不得越过 `JIABAN_CLI_DOWNLOAD_ROOT`；不得访问或覆盖目录、符号链接、junction/reparse point。

仓库静态盘点的 247 个 HTTP 端点具备请求构造覆盖；WebSocket 不包含在 247 内。该数字不代表当前 Profile 有权访问，也不代表端点成功、业务正确或副作用已获授权。

## 强制 dry-run plan

每次 `api request` 先执行完全相同参数的 `--dry-run`：

```text
jiaban --profile test-a api request GET /api/todos --query status=PENDING --dry-run
```

1. 检查返回 `ok=true`，并审阅脱敏摘要的 method、path、query/Header 名称、body 模式、文件字段名/大小/SHA-256。
2. plan 不联网，也不得包含正文、Header 值、凭据或 Token。
3. 普通请求审阅后移除 `--dry-run`；写请求增加 `--yes`。高危请求还必须使用 dry-run 返回的 `--plan-id`，且不得改变输出目标、overwrite 或 reason。
4. method、path、Profile、query、body、文件、输出、确认或 reason 任一变化，都要重新 dry-run。

不得跳过 plan、把旧 plan 用于新请求、并发执行、自动补确认或自行扩大请求范围。

## 写操作规则

- 所有通用请求要求 `JIABAN_CLI_FULL_ACCESS_ENABLED=true`。
- POST/PUT/PATCH 必须有 `--yes --reason <内部测试原因或工单>`。
- DELETE 及路径含 reset-password/status/permissions/approve/reject/sign/publish/forward/archive/withdraw/replace 等高危词的请求，必须额外有 `JIABAN_CLI_DESTRUCTIVE_ENABLED=true`；先 dry-run 获取 5 分钟、单次使用且绑定 Profile/method/path/body/文件哈希的 plan，再用 `--yes --plan-id <id> --reason ...` 执行。
- 只有用户在当前回合明确提出具体写目标时才能执行；环境开关、历史同意和 dry-run 都不能代替当前授权。
- 写请求永不自动重试。任何 401/403 立即停止，不切换身份、不绕过权限。

## 调用规则

1. 保存 Profile 时，仅在私聊且用户明确接受聊天留存风险后，将单个 `{baseUrl,phone,password}` JSON 通过 stdin 交给 `profile save`；不得把 password 放进参数。
2. `profile use` 会修改同一宿主的全局 active 状态。业务命令仍必须显式 `--profile`，以隔离不同对话。
3. 每次只执行完成当前问题所需的最少命令，严格限制 ID、路径、query、文件和输出范围。
4. 写请求的 401 或网络失败绝不重放。GET/HEAD 只在账号密码模式的首次 401 时允许 CLI 重新登录并重试一次；不做一般网络重试。
5. 不跟随重定向，不调用 `/api/auth/login` 通用入口，不尝试 WebSocket。
6. stdout 是单个 JSON。仅当 `ok=true` 时使用结果；失败只读取脱敏后的 `error.code`、`error.message` 和允许的状态信息。
7. JSON 下载先校验 HTTP 与业务码，失败时不得产生文件；成功文件结果只报告 basename、字节数和 SHA-256。不得把绝对输出路径写回聊天。
8. 回复群聊时数据最小化。不得转发无关字段、原始响应、凭据、请求正文或文件内容。

## 结果表达

- 健康检查只说明服务进程响应，不推断数据库或依赖一定健康。
- 未找到时直接说明未找到，不搜索其他对象或猜测身份。
- 合同状态以返回的 `status`、`currentFlowNodeName`、`processActive` 为准。
- 上传/下载结果只报告必要的路径 basename、字节数和校验值，不披露 root 或其他文件。
- 不向用户输出原始 JSON，除非用户明确要求机器可读结果且内容已经脱敏。

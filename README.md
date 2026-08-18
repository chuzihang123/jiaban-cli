# Jiaban CLI

> **Internal isolated testing only：仅用于隔离的内部测试环境，禁止连接生产环境，禁止发布 npm，禁止把它作为面向客户的产品或通用运维工具。**

Jiaban CLI 是家办系统的 Agent 测试适配器。公开仓库 `chuzihang123/jiaban-cli` 仅用于匿名下载经过固定版本和 SHA-256 校验的 Release 包；仓库公开不代表软件可用于生产、对外服务或绕过后端权限。

0.2.0 保留健康检查、认证状态、客户和合同等最小领域命令，并新增受控的 `api request` 高级入口，用于构造和验证仓库中 247 个 HTTP 端点。WebSocket 端点不属于这 247 个 HTTP 端点，也不由本命令支持。

## 环境要求

- Node.js 20 或更高版本；运行时零第三方依赖。
- 未选择 Profile 且未设置 `JIABAN_BASE_URL` 时，默认使用内置测试后端 `https://wnmsnezogvtm.cloud.zyyc.chat`，`health` 也遵循该规则。
- 部署 Secret 可注入 `JIABAN_BASE_URL` 覆盖内置地址，并提供 `JIABAN_SESSION_TOKEN`。
- 或注入可选 `JIABAN_BASE_URL`、`JIABAN_INTEGRATION_PHONE`、`JIABAN_INTEGRATION_PASSWORD`，CLI 自动登录，Token 只保留在当前进程。
- 可选 `JIABAN_ACTIVE_ROLE`：`CUSTOMER`、`MANAGER`、`SENIOR_ADMIN`、`SENIOR_MANAGER`、`BRANCH_GENERAL_MANAGER`、`TRUST_SPECIALIST`、`OPERATIONS`、`WEB_ADMIN`；未设置默认 `SENIOR_ADMIN`。
- 可选 `JIABAN_CONFIG_DIR` 仅用于测试隔离，且必须是绝对路径。
- `api request` 必须显式启用 `JIABAN_CLI_FULL_ACCESS_ENABLED=true`；DELETE 或高危路径还必须显式启用 `JIABAN_CLI_DESTRUCTIVE_ENABLED=true`。
- 上传和下载必须分别配置绝对路径 `JIABAN_CLI_UPLOAD_ROOT`、`JIABAN_CLI_DOWNLOAD_ROOT`；文件不能越过对应 root。

地址、账号、密码和开关必须在 Agent 部署时通过 Secret 或受控进程环境提供，严禁在飞书聊天、命令参数、日志或仓库中直接发送。只允许专用测试账号，严禁个人账号。HTTPS 为默认要求；仅 `localhost`/`127.0.0.1` 隔离测试允许 HTTP。

## 安装

标准内部安装方式是从公开 GitHub Release 匿名安装固定版本包。目标机器需预装 Node.js 20 或更高版本及 npm，无需 GitHub 认证：

```powershell
npm install -g https://github.com/chuzihang123/jiaban-cli/releases/download/v0.2.0/jiaban-cli-0.2.0.tgz
jiaban --version
jiaban --help
```

如需先下载并核对 SHA-256，可选用 GitHub CLI；公开仓库无需认证：

```powershell
gh release download v0.2.0 --repo chuzihang123/jiaban-cli --pattern "jiaban-cli-0.2.0.tgz*" --clobber
Get-FileHash .\jiaban-cli-0.2.0.tgz -Algorithm SHA256
```

无法访问 GitHub 时，可由内部管理员安全传递已校验的本地 tgz，再安装：

```powershell
npm install -g .\jiaban-cli-0.2.0.tgz
jiaban --version
jiaban --help
```

安装后，Skill 位于全局包目录中：

```powershell
$skillPath = Join-Path (npm root -g) '@jiaban\cli\SKILL.md'
Get-Content $skillPath
```

Agent 应从该路径加载包内 `SKILL.md`，不得复制未知来源的 Skill，不得执行 `npm publish`。仅在源码开发目录可使用 `npm ci`、`npm test` 和 `npm link` 联调。

## 基础命令和 Profile

```powershell
jiaban health
jiaban auth status
jiaban customer get --id 1
jiaban contract list --customer-id 1
jiaban contract status --id 1

# 凭据只从 stdin 的单个 JSON 读取，禁止 password 命令行参数
'{"baseUrl":"https://test.example.com","phone":"13800138009","password":"...","activeRole":"TRUST_SPECIALIST"}' |
  jiaban profile save test-a

jiaban profile list
jiaban profile use test-a
jiaban profile current
jiaban --profile test-a health
jiaban profile remove test-a
```

Profile 数据整体使用 AES-256-GCM 加密，随机 32 字节密钥与密文分文件保存在当前用户配置目录；文件权限会尽力设为 `0600`。Windows 默认目录为 `%LOCALAPPDATA%\jiaban-cli`，其他系统为 `~/.config/jiaban-cli`。Token 永不落盘。

后端地址优先级固定为：显式选择或 active Profile 的 `baseUrl` > `JIABAN_BASE_URL` > 内置测试地址。Profile 的地址、账号、密码和 `activeRole` 整组优先于环境变量；旧 Profile 没有 `activeRole` 时兼容默认 `SENIOR_ADMIN`。`profile list/current` 仍只返回名称和 active 状态。

`profile use` 的 active 状态是同一 Agent 宿主上的全局状态，多对话会互相影响。Agent 必须串行执行命令，并在同一对话的每次业务调用中显式写 `--profile <name>`；不要依赖 active profile，也不要并发共享 Profile。

## 通用 HTTP 请求

入口格式：

```text
jiaban --profile <name> api request <METHOD> <PATH> [options]
```

支持 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`。不支持 WebSocket，也拒绝 `CONNECT`、`TRACE`、`OPTIONS`。`PATH` 必须是以 `/api/` 开头的相对 API 路径，不能包含 origin、查询串、fragment、反斜杠、点段或编码后的路径分隔符。查询参数只能通过可重复的 `--query key=value` 传入。

常用选项：

```text
--query key=value                 可重复查询参数
--header "Name: value"            可重复安全 Header
--json-stdin                     从 stdin 读取单个 JSON 请求体
--json-file <absolute-file>      从上传 root 内绝对路径读取 JSON
--body-file <file> --content-type <mime>
--form key=value                  表单字段，可重复
--multipart                      将字段和上传组成 multipart/form-data
--json-part field=<JSON>         multipart JSON 字段，可重复
--upload field=<absolute-file>[;type=<safe-mime>]  上传文件，可重复
--output <absolute-file>         保存响应；二进制响应必须使用
--overwrite                      显式允许覆盖现有普通文件
--dry-run                        只做本地校验，不联网
--yes                            确认执行写请求
--plan-id <id>                   高危 dry-run 生成的5分钟单次凭据
--reason <内部测试原因或工单>
```

GET/HEAD 禁止请求体。`--json-stdin`/`--json-file`、`--body-file`、URL encoded form 和 multipart body 模式互斥。上传会按 `.pdf/.png/.jpg/.docx/.xlsx` 等安全扩展名推断常用 MIME；严格后端需要指定时使用 `field=绝对路径;type=application/pdf`，MIME 中禁止控制符。重复 field 可上传多个文件。请求固定 10 秒超时且不跟随重定向。CLI 自行注入认证，不允许覆盖 `Authorization`、`Cookie`、`Host`、`trust_token`、Content-Type、Origin、方法覆盖、原始 URL、转发或代理 Header，也拒绝 CR/LF 注入。写请求遇到 401 或网络失败绝不自动重放；GET/HEAD 仅在账号密码模式下允许因首次 401 重新登录并重试一次，不做一般网络重试。

示例：

```powershell
jiaban --profile test-a api request GET /api/todos --query status=PENDING --dry-run
jiaban --profile test-a api request GET /api/todos --query status=PENDING

'{"name":"内部测试"}' | jiaban --profile test-a api request POST /api/example `
  --json-stdin --reason "TEST-1001" --dry-run

'{"name":"内部测试"}' | jiaban --profile test-a api request POST /api/example `
  --json-stdin --yes --reason "TEST-1001"

jiaban --profile test-a api request POST /api/files/upload `
  --multipart `
  --form customerId=12 `
  --json-part 'metadata={"kind":"contract"}' `
  --upload "file=C:\jiaban-upload\material.pdf;type=application/pdf" `
  --yes --reason "TEST-1002"

jiaban --profile test-a api request GET /api/files/123/download `
  --output C:\jiaban-download\result.pdf
```

### FULL_ACCESS 与 DESTRUCTIVE

`JIABAN_CLI_FULL_ACCESS_ENABLED=true` 只解锁通用 `api request` 入口，不授予后端权限，也不改变 Profile 身份、角色、租户或数据范围。未精确设置为 `true` 时，`api request` 必须在联网前失败；基础领域命令仍可使用。

`POST`、`PUT`、`PATCH` 执行时必须提供 `--yes --reason`。`DELETE` 以及路径含 `reset-password`、`status`、`permissions`、`approve`、`reject`、`sign`、`publish`、`forward`、`archive`、`withdraw`、`replace` 等高危词的请求，还要求 `JIABAN_CLI_DESTRUCTIVE_ENABLED=true` 和有效 `--plan-id`。环境开关与 plan 都不能替代当前命令的明确确认。任何 401/403 都应停止，不得换身份、扩大路径或尝试绕过。

### dry-run plan 流程

Agent 对所有通用请求都应先以相同请求数据执行 `--dry-run`。CLI 在本地完成 method、路径、Header、body、文件 root、确认和权限开关检查，输出脱敏摘要，且不发出网络请求。摘要只包含方法、路径、查询/Header 名称、body 模式和上传文件的字段名、大小与 SHA-256；不包含 Token、密码、Header 值、query 值或请求正文。

普通请求审阅后移除 `--dry-run`；写请求执行时增加 `--yes`。高危 dry-run 会生成 5 分钟有效、单次使用的 `planId`，绑定 Profile/origin、method、规范路径、query/Header 哈希、body/文件哈希、下载 root 内规范相对目标、overwrite 和 reason 哈希；绝对输出路径与 reason 原文不落 plan。执行时增加 `--yes --plan-id <planId>`，任一绑定项变化都会失败且消费 plan。不得让 Agent 自动确认或在未经用户当前回合明确授权时执行写操作。

### 上传和下载 root

- `JIABAN_CLI_UPLOAD_ROOT`、`JIABAN_CLI_DOWNLOAD_ROOT` 都必须是预先创建的绝对目录。
- `--upload` 和 `--body-file` 只能读取 upload root 内的普通文件；拒绝目录、符号链接、junction/reparse point 和越界路径。
- `--output` 只能写入 download root 内；默认拒绝覆盖，`--overwrite` 也不能覆盖目录或链接。
- 下载使用同目录临时文件，成功后原子改名；失败时不留下部分结果。二进制响应不得写入 stdout。
- 先检查 `Content-Length`，再逐块累计和写临时文件；超过 100 MiB 立即取消并清理。JSON/text 使用更小的有界内存。
- `Content-Type` 为 JSON 时，即使提供 `--output` 也先解析业务码；业务错误不生成文件。合法 JSON 成功响应保存原始 JSON 字节。stdout 文件结果仅含 basename、字节数和 SHA-256，不含绝对路径。
- 文件 root 是文件系统边界，不是后端权限。上传/下载仍受 Profile、后端鉴权和 API 数据范围约束。

## 输出和覆盖范围

stdout 始终只输出一个 JSON 对象。成功示例：

```json
{"ok":true,"command":"api request","response":{"httpStatus":200,"businessCode":200,"data":{}}}
```

失败同样输出脱敏 JSON 并非零退出。退出码：`0` 成功、`1` 内部错误、`2` 参数或确认错误、`3` 配置错误、`4` 认证或授权失败、`5` 未找到、`6` 后端/协议/文件响应错误、`7` 网络或超时。

0.2.0 的构造测试覆盖仓库静态盘点的 247 个 HTTP 端点，包括路径参数、query、JSON、表单、multipart 上传和二进制下载形态；这表示 CLI 能安全构造这些 HTTP 请求，不表示所有角色都能访问、请求一定成功或业务副作用已获批准。WebSocket 路由明确不计入 247，也不支持建立长连接。

## 安全边界

- 仅内部隔离测试、专用测试账号、测试数据；禁止生产环境和真实客户数据。
- 通用请求受部署级开关和命令级 dry-run/确认约束；高危请求还使用短期单次 plan。
- 用户无法覆盖认证 Header；Token、账号、密码、正文和敏感响应字段不得进入聊天、日志或错误输出。
- CLI 不提升权限。后端 401/403、租户隔离和数据范围是最终边界。
- 任何写操作必须来自用户当前回合的明确目标；不得自动确认、批量扩大范围、跟随重定向或重试写请求。
- 247 个端点是 HTTP 构造覆盖，不包含 WebSocket，不是生产验收或授权清单。

# Jiaban CLI

> **Internal isolated testing only：仅用于隔离的内部测试环境，禁止连接生产环境，禁止发布 npm，禁止把它作为面向客户的产品或通用运维工具。**

Jiaban CLI 是家办系统的 Agent 测试适配器。公开仓库和 Release 不包含任何账号、密码或 Token；工具仍仅限已授权的内部隔离测试，禁止用于生产或绕过后端权限。

0.4.1 当前覆盖包优化飞书/Codex Agent 的写操作对话：Agent 从已选操作索引自动生成固定审计原因 `internal-test:<operationId>`，不再向用户询问 reason、测试原因或工单号；GET/HEAD 无请求体、复杂 JSON/multipart 真实字段名和 `admin init` 独立初始化契约继续保持。一个总路由 Skill 与八个角色 Skill 继续按需渐进加载。

## 环境要求

- Node.js 20 或更高版本；运行时零第三方依赖。
- 未选择 Profile 且未设置 `JIABAN_BASE_URL` 时，默认使用内置测试后端 `https://wnmsnezogvtm.cloud.zyyc.chat`，`health` 也遵循该规则。
- 部署 Secret 可注入 `JIABAN_BASE_URL` 覆盖内置地址，并提供 `JIABAN_SESSION_TOKEN`。
- 或注入可选 `JIABAN_BASE_URL`、`JIABAN_INTEGRATION_PHONE`、`JIABAN_INTEGRATION_PASSWORD`，CLI 自动登录，Token 只保留在当前进程。
- 可选 `JIABAN_ACTIVE_ROLE`：`CUSTOMER`、`MANAGER`、`SENIOR_ADMIN`、`SENIOR_MANAGER`、`BRANCH_GENERAL_MANAGER`、`TRUST_SPECIALIST`、`OPERATIONS`、`WEB_ADMIN`；未设置默认 `SENIOR_ADMIN`。
- 可选 `JIABAN_CONFIG_DIR` 仅用于测试隔离，且必须是绝对路径。
- `api request` 在内部测试版中统一启用，无需用户或 Agent 配置额外开关；DELETE 或高危路径仍必须显式启用 `JIABAN_CLI_DESTRUCTIVE_ENABLED=true`。
- 上传和下载必须分别配置绝对路径 `JIABAN_CLI_UPLOAD_ROOT`、`JIABAN_CLI_DOWNLOAD_ROOT`；文件不能越过对应 root。

地址、账号、密码和开关通常应在 Agent 部署时通过 Secret 或受控进程环境提供。唯一例外是用户明确触发下文 `admin init`，可在私密的一对一测试对话中把专用测试管理员凭据仅通过 stdin 交给 CLI；聊天平台仍可能留存输入。任何模式都禁止把密码放入命令参数、日志或仓库，只允许专用测试账号，严禁个人账号。HTTPS 为默认要求；仅 `localhost`/`127.0.0.1` 隔离测试允许 HTTP。

## 安装

标准安装要求目标机器预装 Node.js 20 和 npm。公开 Release 可直接安装，但 CLI 仍只允许用于内部隔离测试：

```powershell
npm install -g ./jiaban-cli-0.4.1.tgz
jiaban --version
jiaban --help
```

安装后，Skill 位于全局包目录中：

```powershell
$skillPath = Join-Path (npm root -g) '@jiaban\cli\SKILL.md'
Get-Content $skillPath
```

Agent 应从该路径加载包内 `SKILL.md`，不得加载未知来源的 Skill，不得执行 `npm publish`。仅在源码开发目录可使用 `npm ci`、`npm test` 和 `npm link` 联调。

## 总 Skill 与八个角色 Skill

安装包内共含九个 Skill 入口：根 `SKILL.md` 是总路由，`skills/*/SKILL.md` 是八个角色入口。飞书或 AI 宿主优先只注册根 Skill；如果宿主不支持按相对链接加载子 Skill，则在部署阶段注册以下九个文件，不能复制文件或凭据：

```text
SKILL.md
skills/web-admin/SKILL.md       WEB_ADMIN / profile web-admin
skills/manager/SKILL.md         MANAGER / profile manager
skills/p9/SKILL.md              SENIOR_ADMIN / profile p9
skills/p8/SKILL.md              BRANCH_GENERAL_MANAGER / profile p8
skills/p7/SKILL.md              SENIOR_MANAGER / profile p7
skills/specialist/SKILL.md      TRUST_SPECIALIST / profile specialist
skills/operations/SKILL.md      OPERATIONS / profile operations
skills/customer/SKILL.md        CUSTOMER / profile customer
```

每个角色使用单独的专用测试账号和预置加密 Profile。一般业务调用每次显式带固定 `--profile`；角色 Skill 不接收账号、密码或 Token，也不执行 Profile 凭据配置。`activeRole` 仅用于核对映射，不是权限沙箱，后端权限、租户和数据范围始终生效。

### 对话式 WEB_ADMIN 初始化

用户明确说“设置管理员账户”或“初始化管理员账户”时，Agent 可在私密的一对一内部测试对话中执行 `jiaban admin init`。命令不接受任何参数，只从 stdin 读取严格单个 JSON `{phone,password}`；禁止额外字段、命令行 password flag、日志回显和审计记录。

CLI 固定连接内置测试后端，以 `activeRole=WEB_ADMIN` 登录并调用 `/api/auth/me` 验证身份；两步全部成功后才在跨进程排他锁内复查并把账号密码用 AES-256-GCM 存为固定 Profile `web-admin`、设为 active。已存在 `web-admin` 时默认拒绝覆盖；并发初始化只允许一个提交。任何登录、协议、角色或提交前写盘失败都 fail-closed，不留下临时文件，原 key/data 字节保持不变。

初始化成功只建立身份配置；通用 `api request` 已统一可用，但不授予任何后端权限。后续每次业务命令仍必须显式使用 `--profile web-admin`，普通写仍需 dry-run、当前回合确认及由Agent固定生成的 `--yes --reason internal-test:<operationId>`，高危请求仍需部署开关和单次 plan。聊天平台本身可能保留用户输入的密码，因此只允许专用测试账号和私密对话；禁止个人账号和生产凭据。

## 基础命令和 Profile

```powershell
jiaban health
jiaban auth status
jiaban customer get --id 1
jiaban contract list --customer-id 1
jiaban contract status --id 1

# 对话式初始化：Agent 将严格 {phone,password} JSON 通过 stdin 发送
# 不要把密码放入命令参数、脚本源码、日志或公开群聊
jiaban admin init

# 凭据只从 stdin 的单个 JSON 读取，禁止 password 命令行参数
'{"baseUrl":"https://test.example.com","phone":"<TEST_PHONE>","password":"<TEST_PASSWORD>","activeRole":"TRUST_SPECIALIST"}' |
  jiaban profile save test-a

jiaban profile list
jiaban profile use test-a
jiaban profile current
jiaban --profile test-a health
jiaban profile remove test-a
```

Profile 数据整体使用 AES-256-GCM 加密，随机 32 字节密钥与密文分文件保存在当前用户配置目录；文件权限会尽力设为 `0600`。Windows 默认目录为 `%LOCALAPPDATA%\jiaban-cli`，其他系统为 `~/.config/jiaban-cli`。Token 永不落盘。

认证配置优先级固定为：显式选择或 active 加密 Profile > 有效环境 session/账号密码。后端地址随选中的整组配置；未配置时使用内置测试地址。旧 Profile 没有 `activeRole` 时兼容默认 `SENIOR_ADMIN`。`profile list/current` 仍只返回名称和 active 状态。

`profile use` 和 `admin init` 设置的 active 状态是同一 Agent 宿主上的全局状态，多对话会互相影响。Agent 必须串行执行命令，并在同一对话的每次业务调用中显式写 `--profile <name>`；不要并发共享 Profile。

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
--reason internal-test:<operationId>  Agent按操作索引固定生成
```

GET/HEAD 禁止请求体。`--json-stdin`/`--json-file`、`--body-file`、URL encoded form 和 multipart body 模式互斥。上传会按 `.pdf/.png/.jpg/.docx/.xlsx` 等安全扩展名推断常用 MIME；严格后端需要指定时使用 `field=绝对路径;type=application/pdf`，MIME 中禁止控制符。重复 field 可上传多个文件。请求固定 10 秒超时且不跟随重定向。CLI 自行注入认证，不允许覆盖 `Authorization`、`Cookie`、`Host`、`trust_token`、Content-Type、Origin、方法覆盖、原始 URL、转发或代理 Header，也拒绝 CR/LF 注入。写请求遇到 401 或网络失败绝不自动重放；GET/HEAD 仅在账号密码模式下允许因首次 401 重新登录并重试一次，不做一般网络重试。

示例：

```powershell
jiaban --profile test-a api request GET /api/todos --query status=PENDING --dry-run
jiaban --profile test-a api request GET /api/todos --query status=PENDING

'{"name":"内部测试"}' | jiaban --profile web-admin api request POST /api/admin/companies `
  --json-stdin --reason "internal-test:admin.company.create" --dry-run

'{"name":"内部测试"}' | jiaban --profile web-admin api request POST /api/admin/companies `
  --json-stdin --yes --reason "internal-test:admin.company.create"

jiaban --profile manager api request POST /api/manager/material-tasks/12/upload `
  --multipart `
  --upload "file=C:\jiaban-upload\material.pdf;type=application/pdf" `
  --yes --reason "internal-test:manager.material.upload"

jiaban --profile test-a api request GET /api/files/123/download `
  --output C:\jiaban-download\result.pdf
```

### 通用接口与 DESTRUCTIVE

内部测试版统一开放通用 `api request` 入口，不需要设置额外环境开关。这只表示 CLI 可以发送已编入 Skill 索引的请求，不授予后端权限，也不改变 Profile 身份、角色、租户或数据范围；所有请求仍由后端鉴权和数据范围规则最终裁决。

`POST`、`PUT`、`PATCH` 执行时必须提供 `--yes --reason`。Agent从已选唯一 `operationId` 固定生成 `internal-test:<operationId>`，不得向用户索要reason、测试原因或工单号；固定reason中不得出现姓名、手机号、对象名称、自由文本、凭据或其他用户输入。`DELETE` 以及路径含 `reset-password`、`status`、`permissions`、`approve`、`reject`、`sign`、`publish`、`forward`、`archive`、`withdraw`、`replace` 等高危词的请求，还要求 `JIABAN_CLI_DESTRUCTIVE_ENABLED=true` 和有效 `--plan-id`。环境开关与 plan 都不能替代当前命令的明确确认。任何 401/403 都应停止，不得换身份、扩大路径或尝试绕过。

### dry-run plan 流程

Agent 对所有通用请求都应先以相同请求数据执行 `--dry-run`。通用写请求的dry-run与正式执行必须携带逐字相同的 `--reason internal-test:<operationId>`；该内部审计字段不能替代用户当前回合确认。CLI 在本地完成 method、路径、Header、body、文件 root、确认和权限开关检查，输出脱敏摘要，且不发出网络请求。摘要只包含方法、路径、查询/Header 名称、body 模式和上传文件的字段名、大小与 SHA-256；不包含 Token、密码、Header 值、query 值或请求正文。

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

CLI 的通用请求层覆盖仓库静态盘点的 HTTP 请求形态，包括路径参数、query、JSON、表单、multipart 上传和二进制下载；这只表示 CLI 能安全构造请求。AI 只允许执行当前角色 `operations.md` 已索引的 `operationId`，未收录操作必须停止并补充手册，不能猜测端点。

## Skill 渐进加载

1. `SKILL.md` 只加载角色路由和操作域索引。
2. 命中唯一角色后，只加载 `skills/<role>/SKILL.md`。
3. 明确业务动作后，再加载该角色同目录 `operations.md`。
4. 只有进入补参、执行或错误阶段时，才加载 `dialog-state.md`、`cli-contract.md`、`safety-policy.md` 或 `error-policy.md`。

例如“创建 P9 + 手机号 + 姓名”不会立即调用接口；`admin.user.create-p9` 还要求明确 `departmentId`（所属公司/部门），Skill 会先补问该参数，再进行 dry-run 和当前回合确认。

## 安全边界

- 仅内部隔离测试、专用测试账号、测试数据；禁止生产环境和真实客户数据。
- 通用请求受部署级开关和命令级 dry-run/确认约束；高危请求还使用短期单次 plan。
- 用户无法覆盖认证 Header；Token、账号、密码、正文和敏感响应字段不得进入聊天、日志或错误输出。
- CLI 不提升权限。后端 401/403、租户隔离和数据范围是最终边界。
- 任何写操作必须来自用户当前回合的明确目标；不得自动确认、批量扩大范围、跟随重定向或重试写请求。
- 247 个端点是 HTTP 构造覆盖，不包含 WebSocket，不是生产验收或授权清单。

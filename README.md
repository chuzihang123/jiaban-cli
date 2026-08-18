# Jiaban CLI

> **Internal test only：纯内部测试工具，禁止用于正式环境，禁止发布 npm 或作为对外软件包分发。**

面向飞书 Agent 受控测试环境的家办系统只读适配器。业务只调用固定 GET 接口；自动认证唯一允许的 POST 是固定 `/api/auth/login`，不提供 raw API 或业务写操作。

## 环境要求

- Node.js 20 或更高版本
- 部署 Secret 可直接注入 `JIABAN_BASE_URL` 与 `JIABAN_SESSION_TOKEN`
- 或注入 `JIABAN_BASE_URL`、`JIABAN_INTEGRATION_PHONE`、`JIABAN_INTEGRATION_PASSWORD`，CLI 自动登录且 Token 仅保留在当前进程内
- 可选 `JIABAN_CONFIG_DIR` 仅用于测试隔离，且必须是绝对路径

地址、账号、密码必须在 Agent 部署时通过 Secret 提供，严禁在飞书聊天中直接发送。只允许专用测试账号，严禁个人账号。命令需要串行执行。

HTTPS 为默认要求；仅 localhost/127.0.0.1 测试允许 HTTP。正式环境永不提供本 CLI。

## 安装

标准内部安装方式是从公开 GitHub Release 匿名安装固定版本包。目标机器需预装 Node.js 20 或更高版本及 npm，无需 GitHub 认证：

```powershell
npm install -g https://github.com/chuzihang123/jiaban-cli/releases/download/v0.1.0/jiaban-cli-0.1.0.tgz
jiaban --version
jiaban --help
```

如需先下载并核对 SHA-256，可选用 GitHub CLI；公开仓库无需认证：

```powershell
gh release download v0.1.0 --repo chuzihang123/jiaban-cli --pattern "jiaban-cli-0.1.0.tgz*" --clobber
Get-FileHash .\jiaban-cli-0.1.0.tgz -Algorithm SHA256
```

无法访问 GitHub 时，可由内部管理员安全传递已校验的本地 tgz，再使用以下备用方式安装：

```powershell
npm install -g .\jiaban-cli-0.1.0.tgz
jiaban --version
jiaban --help
```

安装后，Skill 位于全局包目录中：

```powershell
$skillPath = Join-Path (npm root -g) '@jiaban\cli\SKILL.md'
Get-Content $skillPath
```

Agent 部署时应从该路径加载包内 `SKILL.md`，无需另外下载或复制未知来源的 Skill。不得执行 `npm publish`。

仅在源码开发目录中，可先执行 `npm ci`、`npm test`，再用 `npm link` 联调；`npm link` 不是正式交付安装步骤。

## 命令

```powershell
jiaban health
jiaban auth status
jiaban customer get --id 1
jiaban contract list --customer-id 1
jiaban contract status --id 1
```

## 测试环境 Profile

```powershell
# 凭据必须通过 stdin 单个 JSON 输入；不得使用 password 命令行参数
'{"baseUrl":"https://test.example.com","phone":"13800138009","password":"..."}' |
  jiaban profile save test-a

jiaban profile list
jiaban profile use test-a
jiaban profile current
jiaban --profile test-b health
jiaban profile remove test-a
```

Profile 数据整体使用 AES-256-GCM 加密，随机 32 字节密钥与密文分文件保存在当前用户配置目录；文件权限会尽力设为 `0600`。Windows 默认目录为 `%LOCALAPPDATA%\jiaban-cli`，其他系统为 `~/.config/jiaban-cli`。Token 永不落盘。

`profile use` 的 active 状态是同一 Agent 宿主上的全局状态，多飞书聊天会互相影响。测试时优先让 Agent 在同一对话后续每条命令都显式带 `--profile <name>`；该临时选择不会修改 active。聊天消息本身会留存内容，因此即使 `profile save` 从 stdin 接收，也只能在私聊、专用测试账号且已接受留存风险时使用。

所有命令在 stdout 仅输出一个 JSON 对象：

```json
{"ok":true,"command":"health","data":{"status":"UP","service":"trust-backend"}}
```

失败同样输出 JSON，并以非零状态退出：

```json
{"ok":false,"command":"auth status","error":{"code":"UNAUTHENTICATED","message":"会话未认证或已失效","retryable":false,"httpStatus":401}}
```

退出码：`0` 成功、`1` 内部错误、`2` 参数错误、`3` 配置错误、`4` 认证或授权失败、`5` 未找到、`6` 后端或响应错误、`7` 网络或超时。

客户手机号在输出中固定为 `maskedPhone` 掩码字段。CLI 只返回完成命令所需的最小字段，不透传姓名、归属关系、权限列表、合同文档、日志、识别信息等后端原始字段。

## 安全边界

- 业务只发送固定 GET；唯一 POST 是固定测试账号登录端点 `/api/auth/login`。
- 请求 10 秒超时，拒绝所有 HTTP 重定向。
- `JIABAN_BASE_URL` 不得包含用户名、密码、路径、查询参数或片段。
- Profile 名仅允许字母、数字、下划线和连字符；`--profile` 只选择已保存项，不能传任意 URL。
- 不要把会话 Token、账号或密码写进命令参数、日志、聊天或仓库。

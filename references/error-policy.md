# 错误处理索引

| 错误族 | 给用户的提示 | 后续动作 |
|---|---|---|
| `INVALID_*`, `PROTECTED_HEADER`, `RESERVED_PATH` | 未执行；指出缺少或不允许的字段 | 修正后重新 dry-run，不自动重试 |
| `WRITE_CONFIRMATION_REQUIRED`, `FULL_ACCESS_DISABLED`, `DESTRUCTIVE_DISABLED` | 未执行；缺少写入确认或部署闸门 | 不替用户开启闸门；获得授权后重新 dry-run |
| `PLAN_REQUIRED`, `PLAN_INVALID` | 计划缺失、过期或与当前请求不匹配 | 重新 dry-run、重新确认，禁止复用 |
| `PROFILE_NOT_FOUND`, `PROFILE_STORE_CORRUPT`, `PROFILE_LOCK_TIMEOUT`, `ADMIN_PROFILE_EXISTS` | 本地身份配置不可用或已存在 | 停止并要求人工处理固定 Profile |
| `LOGIN_FAILED`, `UNAUTHENTICATED` | 身份失效或登录失败，未执行 | 停止；不得换 Profile、角色或端点 |
| `FORBIDDEN` | 当前角色无权访问该对象或动作，未执行 | 停止；不得提权、扩大范围或绕路 |
| `NOT_FOUND` | 对象不存在或不在授权范围 | 核对明确 ID；不得枚举相邻 ID |
| `BUSINESS_ERROR`, `HTTP_ERROR`, `INVALID_RESPONSE` | 后端拒绝或响应异常 | 仅报告稳定错误码、requestId/httpStatus；按操作索引补参或停止 |
| `REDIRECT_REJECTED`, `RESPONSE_TOO_LARGE`, `BINARY_OUTPUT_REQUIRED` | 响应被安全规则拒绝 | 不跟随重定向；明确安全输出位置后重做 dry-run |
| `OUTPUT_EXISTS`, `FILE_*`, `*_ROOT_REQUIRED` | 文件范围、类型、大小或覆盖设置不合规 | 修正文件绑定；高危操作重新生成 plan |
| 读请求 `TIMEOUT`, `NETWORK_ERROR` | 读取失败，可询问是否按完全相同绑定重试 | 仅用户同意后人工重试一次 |
| 写请求 `TIMEOUT`, `NETWORK_ERROR` | 结果未知，禁止重放 | 先执行固定只读写后校验或人工查日志 |

不得把后端原始 `message`、堆栈、凭据、请求体、绝对路径或完整个人信息返回给用户。

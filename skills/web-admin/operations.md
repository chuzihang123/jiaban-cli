# WEB_ADMIN 操作索引

字段约定：R0本地/身份，R1精确只读，R2普通写，R3状态或身份影响，R4删除/全量权限/批量。R2以上由Agent固定生成 `--reason internal-test:<operationId>`，dry-run与执行使用同一值，不向用户索要reason或工单；仍需当前回合确认，R3/R4还需单次 plan。

| operationId | 意图 / Method Path | 必填输入 | 可选与默认 | 范围、风险、成功输出 | 写后校验 |
|---|---|---|---|---|---|
| `admin.init` | 初始化管理员；专用本地命令 `jiaban admin init`，不是 generic API | stdin 严格 `{phone,password}` | 禁止 dry-run/plan-id/`--yes`/`--reason`/`--profile`/API path | 固定测试地址、验证WEB_ADMIN、create-only原子保存；独立安全例外；仅输出Profile名/角色 | `jiaban --profile web-admin auth status` |
| `admin.department.tree` | 组织树；GET `/api/admin/departments/tree` | 无 | 无 | 全局启用组织；R1；仅ID/名称/层级 | 无 |
| `admin.company.create` | 创建公司；POST `/api/admin/companies` | `name` | `code`自动，`sort=0` | 全局；R2；返回公司/根部门ID | 重查组织树 |
| `admin.department.create` | 创建部门；POST `/api/admin/departments` | `name`；多公司时`companyId`或`parentId` | `code`自动，`sort=0` | 父子同公司；R2 | 重查组织树 |
| `admin.department.update` | 编辑/移动部门；PUT `/api/admin/departments/{id}` | `id,name` | `companyId,parentId,code,sort` | 禁止移动到自身/后代；R2 | 重查组织树 |
| `admin.department.delete` | 停用部门；DELETE `/api/admin/departments/{id}` | `id` | 无 | 有子部门/用户/客户关联则拒绝；R4 | 重查组织树 |
| `admin.user.list` | 查询内部成员；GET `/api/admin/users` | 无 | 仅用于明确管理清单，不用于猜目标 | 全局内部成员；R1；最小字段 | 无 |
| `admin.user.create` | 创建内部成员；POST `/api/admin/users` | `phone,displayName,roleCode,companyName,departmentName` | `jobTitle`; 按角色由接口解析`managerUserId` | Agent查询组织树并让用户按名称选择；ID仅内部绑定；请求body只提交UserRequest字段；禁止CUSTOMER；R3；只返回新用户ID/角色/状态 | 精确查询或成员清单核对 |
| `admin.user.create-p9` | 创建P9；POST `/api/admin/users`，固定`roleCode=SENIOR_ADMIN` | `phone,displayName,companyName,departmentName` | `jobTitle=P9总经理`; `managerUserId`必须为空 | Agent查询并确认公司/部门；不向用户索要ID；请求body不提交`companyId`；R3 | 核对角色、公司、部门、ENABLED |
| `admin.user.create-p8` | 创建P8；POST `/api/admin/users`，固定`roleCode=BRANCH_GENERAL_MANAGER` | `phone,displayName,companyName,departmentName` | `jobTitle=P8高级经理`; 上级由候选确认 | 上级必须是同公司在岗P9；ID由接口解析且只在内部绑定；R3 | 核对角色、公司、部门、上级、ENABLED |
| `admin.user.create-p7` | 创建P7；POST `/api/admin/users`，固定`roleCode=SENIOR_MANAGER` | `phone,displayName,companyName,departmentName` | `jobTitle=P7高级经理`; 上级由候选确认 | 上级必须是同公司在岗P9；ID由接口解析且只在内部绑定；R3 | 核对角色、公司、部门、上级、ENABLED |
| `admin.user.create-p6` | 创建P6；POST `/api/admin/users`，固定`roleCode=MANAGER` | `phone,displayName,companyName,departmentName` | `jobTitle=P6经理`; 上级由候选确认 | 上级必须是同公司在岗P8或P7；ID由接口解析且只在内部绑定；R3 | 核对角色、公司、部门、上级、ENABLED |
| `admin.user.update` | 编辑成员/换角色；PUT `/api/admin/users/{id}` | `id,phone,displayName,roleCode`及角色所需部门/上级 | `jobTitle` | 全量主角色变更并使旧会话失效；R4 | 精确核对成员角色/部门 |
| `admin.user.status` | 启停成员；PUT `/api/admin/users/{id}/status` | `id,status=ENABLED|DISABLED` | 无 | 会话失效；R3 | 精确核对状态 |
| `admin.user.reset-password` | 重置密码；POST `/api/admin/users/{id}/reset-password` | `id` | 无 | 设置初始密码并强制改密；R4；不输出密码 | 核对状态/审计 |
| `admin.user.delete` | 删除内部成员；DELETE `/api/admin/users/{id}` | `id` | 无 | 有下级、客户、待办等引用则拒绝；R4 | 精确查询确认不存在 |
| `admin.role.list` | 角色列表；GET `/api/admin/roles` | 无 | 无 | R1；只返回必要代码/名称 | 无 |
| `admin.permission.tree` | 权限树；GET `/api/admin/permissions/tree` | 无 | 无 | R1；只返回必要代码/名称 | 无 |
| `admin.role.permissions.replace` | 全量替换角色权限；PUT `/api/admin/roles/{roleId}/permissions` | `roleId,permissionCodes[]`完整集合 | 无 | 非增量；WEB_ADMIN核心权限受保护；R4 | 重查该角色权限 |

## P9/P8/P7/P6 创建引导

1. 先锁定唯一操作：P9/P8/P7/P6分别使用 `admin.user.create-p9/create-p8/create-p7/create-p6`。用户只说“高级经理”时必须先澄清P8还是P7，不能提升或猜测角色。
2. 收集并复述 `displayName` 与 `phone`；手机号仅以掩码形式回显。缺少任一项只补问，不调用接口。
3. 用户只需提供公司名和部门名等自然语言，不得要求普通用户知道 `companyId`、`departmentId` 或 `managerUserId`。Agent先调用 `admin.department.tree`，按 `companyId` 对各部门节点重复携带的公司信息去重，再匹配公司名称：0个公司候选时提示未找到并补问名称；1个候选时展示公司名称并要求确认；多个候选时只展示公司名称供选择。公司确认后，仅在该 `companyId` 下筛选部门：0个候选时停止并说明未找到；1个候选时展示部门名称并要求确认；多个候选时展示部门名称与层级供选择。不得静默选中；只有同名候选无法区分时才显示最小必要ID。
4. 用户选定公司和部门后，Agent在内部绑定 `companyId` 与 `departmentId` 并核对父子归属。P9固定 `managerUserId=null`。P8/P7必须选择同公司、`status=ENABLED`、`roleCode=SENIOR_ADMIN` 的P9；P6必须选择同公司、`status=ENABLED`、角色为 `BRANCH_GENERAL_MANAGER` 或 `SENIOR_MANAGER` 的P8/P7。
5. P8/P7/P6由Agent调用 `admin.user.list`，只在已选公司内筛选合规上级。候选为0时说明必须先创建对应上级并停止；候选为1时只展示姓名、角色、部门并让用户确认；候选多于1时展示同样的最小信息供选择。不得展示手机号，不得要求用户填写 `managerUserId`，不得自动选中、跨公司或枚举无关成员；选定后才在内部绑定该ID。
6. 生成固定字段：P9=`SENIOR_ADMIN/P9总经理`，P8=`BRANCH_GENERAL_MANAGER/P8高级经理`，P7=`SENIOR_MANAGER/P7高级经理`，P6=`MANAGER/P6经理`。最终 `UserRequest` JSON只能包含 `phone,displayName,roleCode,jobTitle,departmentId,managerUserId`，绝不包含 `companyId`。
7. 展示脱敏计划：姓名、掩码手机号、角色、公司名称、部门名称、上级姓名与角色（P9显示“无”）；默认不向用户展示内部ID。Agent自动使用 `--reason internal-test:<operationId>` 执行相同请求的dry-run。任何字段变化都丢弃旧plan并重新dry-run。
8. 只有用户在当前回合明确确认上述对象和影响后，才携带 `--yes` 与本次单次 `plan-id` 执行一次。取消、否认、401/403或plan失效都停止，不换身份、不重放。
9. 成功后按返回ID精确核对 `roleCode,companyId,departmentId,managerUserId,status`，只报告最小结果；校验不一致时报告异常，不再次创建。

创建用户时，`companyId` 是对话范围与部门归属校验参数；后端 `UserRequest` 只有 `phone,displayName,roleCode,jobTitle,departmentId,managerUserId`，因此最终JSON不得附加 `companyId`。不要编造部门 `status` 更新字段：当前编辑DTO不支持；停用只能走 delete 语义。后端权限和关联约束为最终边界。

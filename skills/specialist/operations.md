# TRUST_SPECIALIST 操作索引

| operationId | Method / Path | 必填输入 | 可选 / 范围与风险 |
|---|---|---|---|
| `specialist.flow.create` | POST `/api/specialist/contract-flows` multipart | 先执行recognize；再传`--form customerId=<id>`和`--form recognizedInfoJson=<JSON-array-string>`；识别字段数组至少含JSON属性`key`（fieldKey）=`investmentPath`及`key`（fieldKey）=`deliveryForm`，两项`value`均非空 | 可选`--form title=<text>`；合同重复`--upload contractFiles=<absolute-path>`，SPV重复`--upload spvFiles=<absolute-path>`；field名不可改；R2 |
| `specialist.flow.recognize` | POST `/api/specialist/contract-flows/recognize` multipart | 至少一个`--upload contractFiles=<absolute-path>`或`--upload spvFiles=<absolute-path>` | 两类均可重复；不得传customerId/title/recognizedInfoJson；只识别不建流程；R1型POST |
| `specialist.flow.list` | GET `/api/specialist/contract-flows` | 合法工作队列用途 | 不得用于猜客户或流程；R1 |
| `specialist.flow.get` | GET `/api/specialist/contract-flows/{id}` | `id` | 授权/负责范围；R1 |
| `specialist.review.approve` | POST `/api/specialist/contract-flows/{id}/review/approve` | `id` | comment可选；R3 |
| `specialist.review.reject` | POST `/api/specialist/contract-flows/{id}/review/reject` | `id` | comment建议明确；R3 |
| `specialist.review.recall` | POST `/api/specialist/contract-flows/{id}/review/recall` | `id` | R3 |
| `specialist.flow.revise` | POST `/api/specialist/contract-flows/{id}/revise` | `id` | R3 |
| `specialist.flow.regenerate` | POST `/api/specialist/contract-flows/{id}/four-docs/regenerate` | `id` | R3 |
| `specialist.flow.archive` | POST `/api/specialist/contract-flows/{id}/archive` multipart | `id,file` | R3 |
| `specialist.payment.skip` | POST `/api/specialist/contract-flows/{id}/payment-voucher/skip` | `id` | 仅状态允许；R3 |
| `specialist.return-sign` | POST `/api/specialist/contract-flows/{id}/return-sign` | `id` | 退回客户重签，专员不代签；R3 |
| `specialist.material.approve` | POST `/api/specialist/material-tasks/{taskId}/approve` | `taskId` | comment可选；R3 |
| `specialist.material.reject` | POST `/api/specialist/material-tasks/{taskId}/reject` | `taskId` | comment建议明确；R3 |
| `specialist.template.html.get` | GET `/api/specialist/contract-templates/{id}/html` | 模板`id` | R1 |
| `specialist.template.html.save` | POST `/api/specialist/contract-templates/{id}/html` | 模板`id,templateName,html` | R3 |

模板上传和状态端点虽然暴露在 specialist Controller，当前 service 硬要求 `SENIOR_ADMIN`，因此不建立可执行 operationId；遇到该诉求应报告后端契约缺陷。写后按流程、任务或模板ID精确查询，网络失败不重放。

# CUSTOMER 操作索引

| operationId | Method / Path | 必填输入 | 可选 / 范围与风险 |
|---|---|---|---|
| `customer.agreement.status` | GET `/api/mobile/customer/first-login-agreement` | 无 | 仅本人；R1 |
| `customer.agreement.preview` | POST `/api/mobile/customer/first-login-agreement/preview` | `customerName,idNo` | idType/phone/contactName/address有默认；R1型POST |
| `customer.agreement.submit` | POST `/api/mobile/customer/first-login-agreement` | `customerName,idNo,signatureDataUrl,previewConfirmed=true` | R3 |
| `customer.service.get` | GET `/api/mobile/customer/service` | 无 | 仅本人；R1 |
| `customer.agreement.list` | GET `/api/mobile/customer/agreements` | 无 | 仅本人协议；R1 |
| `customer.report.list` | GET `/api/mobile/customer/reports` | 无 | 仅本人已发布报告；R1 |
| `customer.agreement.fields` | PUT `/api/mobile/customer/agreements/{id}/fields` JSON | 协议`id`；`--json-stdin`传顶层数组（不能包`fields`），每项`fieldKey,fieldValue` | 每项可含`fieldLabel,fieldType`；仅协议允许的fieldKey生效；R2 |
| `customer.agreement.confirm` | POST `/api/mobile/customer/agreements/{id}/confirm` | 协议`id` | 必填字段完整；R3 |
| `customer.profile.get` | GET `/api/mobile/customer/profile` | 无 | R1 |
| `customer.profile.phone` | PUT `/api/mobile/customer/profile` | `phone` | 当前实现仅手机号实际更新；R3 |
| `customer.material.list` | GET `/api/mobile/customer/materials` | 无 | 仅本人材料；R1 |
| `customer.file.list` | GET `/api/mobile/customer/files` | 无 | 仅本人已归档且授权文件；R1 |
| `customer.contract.list` | GET `/api/mobile/customer/contract-flows` | 无 | 仅本人；R1 |
| `customer.contract.confirm-config` | POST `/api/mobile/customer/contract-flows/{id}/confirm-config` | 流程`id` | comment可选；R3 |
| `customer.contract.reject-config` | POST `/api/mobile/customer/contract-flows/{id}/reject-config` | 流程`id` | comment建议明确；R3 |
| `customer.contract.sign-name` | POST `/api/mobile/customer/contract-flows/{id}/sign` JSON | 流程`id,signerName,documentId` | statement可选；R3 |
| `customer.contract.sign-image` | POST `/api/mobile/customer/contract-flows/{id}/sign` multipart | 流程`id,documentId,signature` | PNG/JPEG；R3 |
| `customer.contract.reject-sign` | POST `/api/mobile/customer/contract-flows/{id}/reject-sign` | 流程`id` | R3 |

只能处理当前登录客户本人数据；不得接受其他 customerId。写后按本人协议或流程ID查询状态，网络失败不重放。

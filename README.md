# 医疗推车档案模块（Medical Cart Archive）

医院后勤/护理管理用的医疗推车档案管理模块，支持推车档案维护、照片留存、历史操作审计、
基于角色的权限控制，并强制业务红线：**车辆一旦报废，任何人（含管理员）都无法重新启用或修改**。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express |
| 数据库 | SQLite（better-sqlite3，WAL 模式，外键约束，事务） |
| 认证 | JWT（Bearer Token）+ bcryptjs 口令哈希 |
| 上传 | multer（图片 ≤5MB，jpg/png/gif/webp） |
| 前端 | 原生 HTML/CSS/JS 单页，无需构建 |

## 快速开始

```bash
npm install
npm start          # 初始化数据库并启动 http://localhost:3000
# 其他命令
npm run seed       # 仅初始化/写入种子数据
npm run reset      # 删除数据库并重新写入种子（演示前一键还原）
```

浏览器打开 <http://localhost:3000> 即可演示。

## 演示账号（RBAC 三级权限）

| 账号 | 密码 | 角色 | 能做什么 |
|---|---|---|---|
| `admin` | `admin123` | 管理员 | 全部操作，**仅管理员可报废 / 删除** |
| `nurse1` | `nurse123` | 责任护士 | 建档、编辑、消毒登记、照片上传、普通状态流转 |
| `viewer1` | `viewer123` | 巡查员（只读） | 仅查看列表与详情 |

权限不足时后端返回 `403` 并给出中文原因；前端按角色自动隐藏/禁用操作按钮。

## 功能清单

- **档案字段**：推车编号（唯一）、科室、药箱配置（多项）、责任护士、消毒日期时间、
  使用状态（使用中 / 闲置 / 维修中 / 已报废）、备注。
- **列表页**：按编号/护士关键字、科室、状态组合筛选。
- **详情页**：
  - 完整档案信息与药箱配置；
  - 推车照片墙，支持上传带说明的照片，点击放大；
  - 历史操作审计（谁、什么时间、做了什么、变更前后值）。
- **消毒登记**：独立操作入口并写入审计日志。
- **报废锁定（核心红线）**：
  - 报废仅 `admin` 可执行，需填写原因并二次确认；
  - 报废后：禁止改状态（不能重新启用）、禁止编辑、禁止消毒、禁止上传照片；
  - 后端 `PATCH /:id/status`、`PUT /:id`、`/:id/sterilize`、`/:id/photos` 四处独立拦截，
    即使绕过前端直接调接口也一律返回 `409`。

## 可演示的「数据库连接」与「权限验证」

1. **数据库连接**
   - 启动日志打印 `[DB] 已连接 SQLite：.../data/carts.db`；
   - 页面右上角每 15 秒轮询健康灯：🟢 数据库已连接；
   - 接口 `GET /api/auth/health` 返回 `{"database":"connected"}`（无需登录）。
2. **权限验证**
   - 服务端控制台实时打印每个请求的方法、路径和是否携带 Token；
   - 无 Token 调接口 → `401`；错误角色调接口 → `403`（含所需权限说明）；
   - 可用下方 curl 脚本直接演示。

## 建议演示脚本（curl）

```bash
B=http://localhost:3000
# 无令牌 → 401
curl -s $B/api/carts
# 登录拿 token
TA=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')
# 带令牌查列表
curl -s "$B/api/carts" -H "Authorization: Bearer $TA"
# 红线演示：种子里 TC-009(id=4) 已报废，管理员尝试重新启用 → 409
curl -s -X PATCH $B/api/carts/4/status -H "Authorization: Bearer $TA" \
  -H 'Content-Type: application/json' -d '{"status":"in_use"}'
```

## API 一览

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/login` | 公开 | 登录获取 JWT |
| GET | `/api/auth/me` | 登录 | 校验令牌 / 当前身份 |
| GET | `/api/auth/health` | 公开 | 数据库连接健康检查 |
| GET | `/api/carts` | 登录 | 列表 + 筛选（keyword/department/status） |
| POST | `/api/carts` | nurse+ | 新建档案（编号唯一） |
| GET | `/api/carts/:id` | 登录 | 详情（含照片、审计日志） |
| PUT | `/api/carts/:id` | nurse+ | 编辑（报废车 409） |
| POST | `/api/carts/:id/sterilize` | nurse+ | 消毒登记（报废车 409） |
| PATCH | `/api/carts/:id/status` | nurse+；报废仅 admin | 状态流转（报废车一律 409） |
| POST | `/api/carts/:id/photos` | nurse+ | 上传照片（报废车 409） |
| DELETE | `/api/carts/:id` | admin | 删除档案（级联照片/日志） |

## 数据表

- `users` 用户（用户名、姓名、bcrypt 口令哈希、角色）
- `carts` 推车档案
- `photos` 照片（外键级联删除）
- `audit_logs` 历史操作（cart_id / 操作人 / 动作 / 变更前后 JSON）

## 目录结构

```
server/
  index.js          入口
  db.js             数据库连接、建表、种子数据
  auth.js           JWT 认证 + RBAC 中间件
  routes/auth.js    登录/me/health
  routes/carts.js   推车档案全部业务接口（含报废锁定）
public/             前端单页（index.html / css / js）
uploads/            上传照片
data/carts.db       SQLite 数据文件（自动生成）
```

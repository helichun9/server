# YJK-tool 后端服务

零依赖的 Node.js 单文件服务，提供账号 / 好友 / 全站用户管理。

## 本地试跑

```bash
cd server
node server.js
# 打开 http://localhost:3000/api/ping 看到 JSON 就成功了
```

---

## 部署到云（选一种）

### 方案 A：Render.com（推荐，免费）

1. 注册 https://render.com
2. 把 `server` 文件夹上传到 GitHub 仓库（可以把 `server.js` 和 `package.json` 放仓库根目录）
3. Render 控制台 → **New** → **Web Service** → 选你的仓库
4. 配置：
   - **Runtime**：Node
   - **Build Command**：留空（零依赖，不用装包）
   - **Start Command**：`node server.js`
   - **Instance Type**：Free
5. 部署完后会拿到一个地址，例如 `https://yjktool-api.onrender.com`

> ⚠️ 免费版 15 分钟无人访问会休眠，下次请求要等 30 秒左右唤醒。
> 想避免的话可以在 https://uptimerobot.com 加一个每 10 分钟 ping 一下 `/api/ping` 的监控。

### 方案 B：Replit（最快，适合先试）

1. 打开 https://replit.com → **Create** → 选 **Node.js**
2. 把 `server.js` 内容整个粘进 `index.js`
3. 点 **Run**，右边 Webview 里就有公网地址

### 方案 C：自己的服务器 / VPS

```bash
node server.js &
# 或配合 pm2 常驻：npm i -g pm2 && pm2 start server.js --name yjktool
```

记得开放端口，或用 Nginx 反代并配上 HTTPS（**强烈建议用 HTTPS**，否则浏览器可能拦截请求）。

---

## 环境变量（可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `DATA_FILE` | `./data.json` | 数据文件位置 |
| `DEV_NAME` | `YJK` | 开发者用户名 |
| `DEV_PASS` | `helichun0206` | 开发者初始密码 |
| `ALLOW_ORIGIN` | `*` | 允许的前端域名，建议改成你的网址 |

---

## 部署完之后

回到网站 → 「设置」→ 找到 **服务器** 一栏 → 填入后端地址（例如 `https://yjktool-api.onrender.com`）→ 点「测试连接」。

连上之后就会自动切到 **在线模式**：

- 登录 / 注册走服务器，**所有用户互通**
- 「我的」页面出现 **好友** 区：搜索用户、发送/同意/拒绝好友请求
- 开发者面板出现 **全站用户**：查看所有注册用户、在线状态、好友数、改角色/封禁/删除

没配置或连不上时会自动回退到 **本地模式**，网站照常能用。

---

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 连通性检查 |
| POST | `/api/register` | 注册 `{name, pwd, pwd2}` |
| POST | `/api/login` | 登录 `{name, pwd}` |
| POST | `/api/logout` | 登出 |
| GET | `/api/me` | 当前用户 |
| GET | `/api/users?q=` | 搜索用户 |
| GET | `/api/friends` | 好友 / 待处理请求 |
| POST | `/api/friends/request` | 发送请求 `{name}` |
| POST | `/api/friends/accept` | 同意 `{name}` |
| POST | `/api/friends/reject` | 拒绝 `{name}` |
| DELETE | `/api/friends?name=` | 删除好友 |
| POST | `/api/profile` | 改头像 `{avatar}` |
| POST | `/api/password` | 改密码 `{oldPwd, newPwd}` |
| GET | `/api/admin/users` | 全站用户（开发者/管理员） |
| POST | `/api/admin/role` | 改角色（仅开发者） |
| POST | `/api/admin/ban` | 封禁/解封（仅开发者） |
| DELETE | `/api/admin/user?name=` | 删除账号（仅开发者） |

需要登录的接口请带 `Authorization: Bearer <token>`。

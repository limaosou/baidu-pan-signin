# baidu-pan-signin

百度网盘**每日自动签到** WorkBuddy Skill —— 自动完成会员签到、每日成长值答题，并查询当前会员等级与成长值。零依赖，仅需 Node.js ≥ 18。

> 签到 +5、每日答题 +5，顺带查一次成长值。全年不间断约可累积 6000+ 成长值。

## 功能

- ✅ 每日签到领取积分
- 🤖 自动获取并回答每日成长值题目（拿满分答案，无需人工看题）
- 📊 签到后查询会员等级与成长值
- 🔁 幂等：同一天重复执行会判定为「今日已签到/已答」，不会误报失败
- 💡 零依赖：只用 Node 内置 `fetch`，无需 `npm install`

## 工作原理

直接调用百度网盘网页端的 4 个内部接口，**不是百度官方开放 API**，仅依赖浏览器的登录 Cookie：

| 步骤 | 接口 |
|---|---|
| 1. 签到 | `rest/2.0/membership/level?...&method=signin` |
| 2. 取每日题 | `act/v2/membergrowv2/getdailyquestion` |
| 3. 提交答案 | `act/v2/membergrowv2/answerquestion?...&ask_id=&answer=` |
| 4. 查会员信息 | `rest/2.0/membership/user?...&method=query` |

> 接口契约、字段别名、鉴权失败的多种表现形式详见 [`reference/api.md`](reference/api.md)。

## 安装（WorkBuddy）

把本仓库克隆到 WorkBuddy 的用户级 skill 目录即可被自动加载：

```bash
# macOS / Linux
git clone https://github.com/matian69-a11y/baidu-pan-signin.git \
  ~/.workbuddy/skills/baidu-pan-signin

# Windows (PowerShell)
git clone https://github.com/matian69-a11y/baidu-pan-signin.git `
  "$env:USERPROFILE\.workbuddy\skills\baidu-pan-signin"
```

重启 WorkBuddy，对话里说「百度网盘签到」即可触发。

> 也可作为普通命令行脚本使用（见下文），不依赖 WorkBuddy。

## 配置 Cookie（首次必须先做）

脚本靠 Cookie 代表你的网盘身份，**没有 Cookie 就一定失败**。Cookie 等同于网盘登录凭据，请妥善保管。

1. 浏览器打开并登录 <https://pan.baidu.com>
2. F12 → Network（网络）→ 刷新页面 → 点任意 `pan.baidu.com` 请求 → Headers → Request Headers
3. 复制 `Cookie:` 后面那一整串（以 `BDUSS=` 开头）
4. 写入 `config/cookie.txt`（可从 `config/cookie.txt.example` 复制改名），整串一行，不要换行
5. 验证：`node scripts/signin.js`

或设置环境变量（优先级更高）：

```bash
# Windows PowerShell
$env:BAIDU_PAN_COOKIE="BDUSS=xxx; BAIDUID=xxx:FG=1; ..."
# macOS / Linux
export BAIDU_PAN_COOKIE="BDUSS=xxx; BAIDUID=xxx:FG=1; ..."
```

> 完整图文步骤与常见报错见 [`reference/cookie-guide.md`](reference/cookie-guide.md)。

## 使用

```bash
# 正常执行（人类可读输出）
node scripts/signin.js

# 自动化场景：输出 JSON
node scripts/signin.js --json

# 排障：打印接口原始响应
node scripts/signin.js --raw

# 只签到 + 查成长值，跳过答题
node scripts/signin.js --no-answer

# 查看帮助
node scripts/signin.js --help
```

退出码：`0` 全部成功（含今日已签到/已答）、`1` 失败（Cookie 缺失/失效、网络异常、接口报错）。

## 每日自动签到（可选）

### 在 WorkBuddy 里

创建一个每日定时任务，命令填：

```bash
node "<skill目录>/scripts/signin.js" --json
```

（`--json` 便于自动化解析结果。）

### 其他平台

任何能定时跑命令的环境都行（cron、青龙面板、云函数、GitHub Actions 定时任务等）：
把 Cookie 放进环境变量 `BAIDU_PAN_COOKIE`，然后定时执行 `node scripts/signin.js --json`，
解析 JSON 里的 `steps` 即可。

> 注意：百度有风控意识，建议在长期固定 IP 的设备上运行，避免使用频繁切换的动态 IP，以防影响网盘正常下载。

## Cookie 失效怎么办

Cookie 通常数月有效，以下情况会失效：修改密码、退出登录、长时间不活跃、被风控判定异地登录。
脚本检测到失效会输出 `[!] Cookie 疑似失效`，按 [`reference/cookie-guide.md`](reference/cookie-guide.md) 重新抓取覆盖即可。

## 文件结构

```
baidu-pan-signin/
├── SKILL.md                  # WorkBuddy skill 入口（触发规则、用法）
├── README.md                 # 本文件
├── VERSION
├── .gitignore
├── scripts/signin.js         # 主脚本（Node ≥ 18，零依赖）
├── config/
│   └── cookie.txt.example    # Cookie 模板（真实 Cookie 请填到 cookie.txt，不入库）
├── reference/
│   ├── cookie-guide.md       # Cookie 提取图文步骤 + 报错对照
│   └── api.md                # 接口契约与踩坑记录
└── logs/                     # 每日执行日志（自动生成，不入库）
```

## 安全与免责声明

- ⚠️ **Cookie 等同账号密码**：请仅存放在本机 `config/cookie.txt` 或私有环境变量，**切勿提交到 Git、发到公开渠道或分享给他人**。
- 本工具仅供个人自动化签到使用，请勿用于刷量、撞库或任何违反服务条款的行为。
- 百度随时可能调整上述内部接口，导致脚本失效；届时请带 `--raw` 抓包对照 [`reference/api.md`](reference/api.md) 更新。
- 使用本工具产生的任何后果由使用者自行承担。

## License

MIT

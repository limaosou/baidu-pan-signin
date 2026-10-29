---
name: baidu-pan-signin
description: >-
  百度网盘每日自动签到 — 自动完成会员签到、每日成长值答题，并查询当前会员等级与成长值。
  TRIGGER: 用户提到"百度网盘签到"、"网盘签到"、"签到网盘"、"bdpan 签到"、"signin 百度网盘"，
           或被定时任务要求执行百度网盘签到。
  DO NOT TRIGGER: 网盘文件上传/下载/分享/搜索等文件操作（那是 baidu-drive skill 的职责）；
                  其他平台的签到（京东、B站等）。
allowed-tools: Bash, Read, AskUserQuestion
argument-hint: "[--json|--raw|--no-answer]"
---

# 百度网盘每日签到 Skill

每天两件事：签到 +5 积分、每日答题 +5 积分，顺带查一下会员等级和成长值。全年不间断约可累积 6000+ 成长值。

## 工作原理

直接调用百度网盘网页端 4 个 HTTP 接口，**不需要也不使用百度网盘官方 API 授权**，仅依赖浏览器 Cookie：

| 步骤 | 接口 |
|---|---|
| 1. 签到 | `pan.baidu.com/rest/2.0/membership/level?...&method=signin` |
| 2. 取每日题 | `pan.baidu.com/act/v2/membergrowv2/getdailyquestion?...` |
| 3. 提交答案 | `pan.baidu.com/act/v2/membergrowv2/answerquestion?...&ask_id=&answer=` |
| 4. 查会员信息 | `pan.baidu.com/rest/2.0/membership/user?...&method=query` |

接口契约详见 [reference/api.md](./reference/api.md)。

## 执行方式

```bash
# 正常执行（人类可读输出）
node "${CLAUDE_SKILL_DIR}/scripts/signin.js"

# 自动化场景：JSON 输出
node "${CLAUDE_SKILL_DIR}/scripts/signin.js" --json

# 排障：打印接口原文
node "${CLAUDE_SKILL_DIR}/scripts/signin.js" --raw

# 只签到 + 查成长值，跳过答题
node "${CLAUDE_SKILL_DIR}/scripts/signin.js" --no-answer
```

> 变量名以具体运行环境为准：WorkBuddy 一般注入 `${CLAUDE_SKILL_DIR}`；
> 其他框架可能是 `${SKILL_DIR}`。若你的环境没有该变量，把它替换成 skill 根目录的绝对路径即可，例如：
> - macOS / Linux：`~/.workbuddy/skills/baidu-pan-signin/scripts/signin.js`
> - Windows：`%USERPROFILE%\.workbuddy\skills\baidu-pan-signin\scripts\signin.js`

## Cookie 配置（首次必须先做）

脚本靠 Cookie 代表你的网盘身份，**没有 Cookie 就一定失败**。

- **方式 A（推荐）**：把完整 Cookie 写入 `config/cookie.txt`
- **方式 B**：设置环境变量 `BAIDU_PAN_COOKIE`（优先级更高）

提取步骤见 [reference/cookie-guide.md](./reference/cookie-guide.md)。

未配置时脚本会打印完整引导并退出码 1 —— 此时应把引导内容转给用户，**不要自己编造 Cookie**。

## 结果解释

| 现象 | 含义 | 处理 |
|---|---|---|
| `[√] 签到：签到成功，获得积分 5` | 正常 | 无需处理 |
| `[√] 签到：今日已签到（重复执行，忽略）` | 当天已跑过 | 正常，非错误 |
| `[√] 答题：今日已答题（重复执行，忽略）` | 当天已跑过 | 正常，非错误 |
| `[!] Cookie 疑似失效` | BDUSS 过期或被挤下线 | 重新抓 Cookie（见 cookie-guide.md） |
| `[×] 签到：errno=xxx ...` | 接口报错 | 带 `--raw` 重跑，原文贴给用户 |
| `[√] 答题：今日无可用题目...` | 当天没题或接口没给答案 | 正常跳过 |
| 退出码 1 | 有步骤失败 | 检查 `logs/signin-<日期>.log` |

**注意**：`already` / `skipped` 状态在 JSON 里是 `ok: true`，自动化汇报时不要当成失败。

## 安全约束

1. **Cookie 就是账号凭据**：严禁输出到对话以外、严禁提交 Git、严禁上传到任何云端。
2. 读取配置只允许通过 `scripts/signin.js` 内部逻辑完成。
3. 本 skill **只读 + 领取** 性质，不做任何删除/修改网盘文件的操作。
4. 不要执行任何"批量ipl去重""撞库"式的请求；每日 4 次请求足够。
5. Cookie 更新必须由用户手动粘贴触发，禁止自动无头登录尝试。

## 文件结构

```
baidu-pan-signin/
├── SKILL.md                  # 本文件
├── VERSION
├── scripts/signin.js         # 主脚本（Node >= 18，零依赖）
├── config/cookie.txt         # Cookie（用户自建，不入库）
├── reference/cookie-guide.md # Cookie 提取图文步骤
├── reference/api.md          # 接口契约
└── logs/                     # 每日执行日志（自动生成）
```

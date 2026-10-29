# 百度网盘签到接口契约

记录 `scripts/signin.js` 调用的 4 个接口原始信息，供接口变动时对照排查。

> 这些都是**网页端内部接口**（`app_id=250528` 为网盘会员成长值任务），不是百度官方开放 API，
> 百度随时可能调整。失效时先在浏览器里手动点一次签到，抓包对比新接口。

## 通用请求方式

- **方法**：全部 GET
- **认证**：Header `Cookie: <完整浏览器 Cookie>`，核心字段 `BDUSS`
- **公共参数**：`app_id=250528`、`web=5`
- **关键 Header**：
  ```
  Accept: application/json, text/plain, */*
  X-Requested-With: XMLHttpRequest
  Referer: https://pan.baidu.com/wap/svip/growth/task
  Accept-Language: zh-CN,zh;q=0.9
  User-Agent: <桌面版 Chrome UA>
  ```

## 「今天已经做过了」不是失败（重要）

同一天重复调用会拿到 **英文** 错误文案，中文正则匹配不上，容易被误判成失败：

| 接口 | 重复执行返回 |
|---|---|
| 签到 | `errno=421001` + `error_msg:"repeat signin"` |
| 答题 | `errno=9502` + `show_msg:"ask answer num exceeded limit"` |

脚本用 **errno 白名单**（`421001`、`9502`）+ 文案正则兜底判定，这两种情况标记为 `already: true`、整体 `success: true`、退出码 0。

## 鉴权失败的三种表现形式（重要）

同样的「Cookie 无效」，三个接口的表现**完全不一样**，不要以为 HTTP 200 就等于成功：

| 接口 | 无效 Cookie 时的表现 |
|---|---|
| 签到 | `HTTP 400` + `{"error_code":100002,"error_msg":"Param error"}` |
| 取题/答题 | `HTTP 200` + `{"errno":-6,"show_msg":"账户已过期，重新登陆"}` |
| 用户信息 | `HTTP 302` → `https://pan.baidu.com/403.html` + `{"error_code":36003,"error_msg":"no authority"}` |

因此脚本必须：
1. `redirect: 'manual'`——跟随 302 会让 undici 抛 `terminated`，把真实错误信息吞掉
2. 每个步骤都独立做鉴权判定（errno 白名单 + 文案正则），不能只看 HTTP 状态码

## 1. 每日签到

```
GET https://pan.baidu.com/rest/2.0/membership/level?app_id=250528&web=5&method=signin
```

成功：HTTP 200，`errno` 为 0 或不存在，含 `points` 字段（本次获得积分，通常 5）。
重复签到：`errno != 0` 且 `error_msg` 含"已签/重复/already"等字样。

## 2. 获取每日题目

```
GET https://pan.baidu.com/act/v2/membergrowv2/getdailyquestion?app_id=250528&web=5
```

返回含 `ask_id`（题目 ID）和 `answer`（正确答案序号，整数）。
若两者任一缺失 → 当天没题或接口未返回答案，脚本跳过答题。

## 3. 提交答案

```
GET https://pan.baidu.com/act/v2/membergrowv2/answerquestion?app_id=250528&web=5&ask_id={ask_id}&answer={answer}
```

成功：含 `score`（获得积分，通常 5）与 `show_msg`（结果提示文案）。

## 4. 查询会员信息

```
GET https://pan.baidu.com/rest/2.0/membership/user?app_id=250528&web=5&method=query
```

返回含 `current_level`（会员等级）与 `current_value`（当前成长值）。

## 字段别名兜底

百度不同版本的响应字段名不一致，脚本对以下别名做了兜底查找（先 JSON 递归，再正则）：

| 语义 | 尝试的字段名 |
|---|---|
| 积分 | `points` / `point` / `score` / `sign_point` |
| 错误码 | `errno` |
| 错误文案 | `error_msg` / `show_msg` / `errmsg` |
| 会员等级 | `current_level` / `level` / `member_level` |
| 成长值 | `current_value` / `growth` / `growth_value` / `value` |

## 排障

接口变了的表现：脚本输出 `[×] ... 未能解析会员等级/成长值`，或 `errno=xxx`。
处理：`node scripts/signin.js --raw` 打印原文，再到浏览器里手动操作一次并抓包对比。

参考实现（社区维护，本 skill 的接口出处）：
- https://github.com/ms12138/DuPan
- https://github.com/tunecc/DuPan

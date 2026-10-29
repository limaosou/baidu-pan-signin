# 百度网盘 Cookie 提取指南

Cookie 就是你在网盘的登录凭据。整个流程 3 分钟，每年大概重做 2–3 次。

## 方法一：浏览器 F12（最稳，推荐）

1. **打开并登录** <https://pan.baidu.com>（必须用你要签到的那个账号）
2. 按 **F12** 打开开发者工具，点顶端 **Network（网络）** 标签
3. 按 **F5** 刷新页面，Network 面板会刷出一堆请求
4. 在列表里**随便点一个域名是 `pan.baidu.com` 的请求**（点 `disk/home` 那条主文档最保险）
5. 右侧面板点 **Headers（标头）**，往下滚到 **Request Headers（请求标头）**
6. 找到 `Cookie:` 那一行，**从它冒号后面开始，复制完整的一长串**
   - 通常以 `BDUSS=` 开头
   - 长度几百到上千字符
   - 中间有分号和空格，都保留

   ```
   Request Headers
   ---------------------------------
   :authority: pan.baidu.com
   ...
   Cookie: BDUSS=xxxxx; PSTM=xxxxx; BAIDUID=xxxxx:FG=1; ...   ← 复制冒号后面这一整串
   ```

7. 粘贴到 `config/cookie.txt`（可从 `cookie.txt.example` 复制改名），**整串一行，不要换行**
8. 验证：`node scripts/signin.js`

## 方法二：浏览器扩展

- 安装扩展 **Get Cookies.txt** 或 **Cookie-Editor**
- 打开 <https://pan.baidu.com> 并登录
- 点扩展图标 → Export / Copy as "Netscape format" 或 Header string
- 若是 Netscape 格式（`domain\t...\tname\tvalue`），**先转换**成 `name=value; name=value; ...` 格式再用

> 提示：有用户反馈部分扩展导出的 Cookie 百度不认，method 一失败就用方法一。

## 最少需要哪些字段

理论上只要这两个就够：

```
BDUSS=xxxxx; BAIDUID=xxxxx;
```

但实际不同时期百度的校验不一样，**直接贴完整 Cookie 成功率最高**，别精简。

## Cookie 什么时候会失效

| 情况 | 是否失效 |
|---|---|
| 正常浏览 pan.baidu.com | 否 |
| 在别处退出登录 / 修改密码 | **是** |
| 长时间（数月）不活跃 | 可能 |
| 百度风控判定异地登录 | 可能 |

脚本检测到失效会输出 `[!] Cookie 疑似失效`，此时重做一遍上面的步骤即可。

## 常见报错对照

| 提示 | 原因 | 处理 |
|---|---|---|
| `[!] Cookie 里没检测到 BDUSS=` | 复制少了，或带了 `Cookie:` 前缀 | 重复制，确认以 `BDUSS=` 开头 |
| `[!] Cookie 疑似失效` | 过期/被挤下线 | 重新提取 |
| HTTP 403 / 429 | 触发风控 | 隔几小时再试，别连点 |
| 签到成功但没积分 | 当天已签到，或账号等级过低 | 正常现象 |

## 安全提醒

- Cookie 等同于账号密码，**不要发给任何人、不要贴到公开 issue、不要提交 Git**
- `config/cookie.txt` 已被设计为本地私密文件，如在本目录用 Git 自行核对 `.gitignore`
- 建议只在自己长期使用的设备上配置，避免异地 IP 触发风控影响正常下载

#!/usr/bin/env node
/**
 * 百度网盘每日签到 + 每日答题 + 成长值查询
 *
 * 零依赖：仅使用 Node >= 18 内置的 fetch / fs / path。
 *
 * 用法：
 *   node signin.js                 # 正常执行（人类可读输出）
 *   node signin.js --json          # 机器可读输出（供自动化调用）
 *   node signin.js --no-answer     # 跳过每日答题，只签到 + 查成长值
 *   node signin.js --raw           # 打印接口原始响应，用于排障
 *   node signin.js --help
 *
 * Cookie 来源优先级：
 *   1. 环境变量 BAIDU_PAN_COOKIE
 *   2. 配置文件 config/cookie.txt
 *
 * 退出码：
 *   0  全部成功（或今日已签到，属正常）
 *   1  执行失败（Cookie 缺失/失效、网络异常、接口报错）
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 常量配置

const ROOT = path.resolve(__dirname, '..');
const COOKIE_FILE = path.join(ROOT, 'config', 'cookie.txt');
const LOG_DIR = path.join(ROOT, 'logs');
const GUIDE_FILE = path.join(ROOT, 'reference', 'cookie-guide.md');

const VERSION = '1.0.0';

const APP_ID = '250528';
const WEB = '5';

const API = {
  signin: `https://pan.baidu.com/rest/2.0/membership/level?app_id=${APP_ID}&web=${WEB}&method=signin`,
  question: `https://pan.baidu.com/act/v2/membergrowv2/getdailyquestion?app_id=${APP_ID}&web=${WEB}`,
  answer: (askId, answer) =>
    `https://pan.baidu.com/act/v2/membergrowv2/answerquestion?app_id=${APP_ID}&web=${WEB}` +
    `&ask_id=${encodeURIComponent(askId)}&answer=${encodeURIComponent(answer)}`,
  user: `https://pan.baidu.com/rest/2.0/membership/user?app_id=${APP_ID}&web=${WEB}&method=query`,
};

const HEADERS = {
  // 不要用 keep-alive：百度端会提前关闭连接，undici 复用失效 socket 会抛 terminated
  Connection: 'close',
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/120.0.0.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: 'https://pan.baidu.com/wap/svip/growth/task',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/**
 * Cookie 失效的典型信号。
 * 注意百度返回的文案里既有"登录"也有"登陆"（账户已过期，重新登陆），两个字都要覆盖。
 */
const COOKIE_DEAD_RE =
  /未\s*登\s*[录陆]|登\s*[录陆]\s*已过期|重新\s*登\s*[录陆]|请\s*重\s*新\s*登|用户不存在|no\s*login|not\s*login/i;

/** 代表未登录/过期的 errno 值 */
const AUTH_ERRNO = new Set([-6, 2, 10, 111]);

/**
 * 代表「今天已经做过了」的 errno —— 这不是失败，属正常幂等结果。
 * 实测百度返回的是英文文案，靠中文正则匹配会漏判，所以用 errno 白名单兜底：
 *   421001 → repeat signin（今日已签到）
 *   9502   → ask answer num exceeded limit（今日答题次数已用完）
 */
const ALREADY_ERRNO = new Set([421001, 9502]);

/** 文案兜底：将来 errno 变了还能认出来 */
const ALREADY_RE =
  /已签|已答|已领|已打卡|今日已|重复|repeat|already|duplicat|exceed|no\s*times|times\s*limit/i;

// ---------------------------------------------------------------- 工具函数

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readCookie() {
  const fromEnv = (process.env.BAIDU_PAN_COOKIE || '').trim();
  if (fromEnv) return { value: fromEnv, source: 'env:BAIDU_PAN_COOKIE' };

  if (fs.existsSync(COOKIE_FILE)) {
    const raw = fs.readFileSync(COOKIE_FILE, 'utf8');
    const line = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
      .join(' ');
    if (line) return { value: line, source: `file:${COOKIE_FILE}` };
  }
  return { value: '', source: 'none' };
}

/** 尝试解析 JSON；失败则返回 null（配合正则兜底） */
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 在任意嵌套结构中按 key 名找第一个值 */
function deepFind(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of Object.keys(obj)) {
    if (keys.includes(k) && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  for (const k of Object.keys(obj)) {
    const hit = deepFind(obj[k], keys);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 先走 JSON 结构化解析，失败再用正则从原始文本里抠数字 */
function pickNumber(text, json, keys) {
  if (json) {
    const v = deepFind(json, keys);
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  }
  for (const k of keys) {
    const m = text.match(new RegExp(`${k}"\\s*:\\s*(-?\\d+)`));
    if (m) return Number(m[1]);
  }
  return undefined;
}

function pickString(text, json, keys) {
  if (json) {
    const v = deepFind(json, keys);
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  for (const k of keys) {
    const m = text.match(new RegExp(`${k}"\\s*:\\s*"([^"]*)"`));
    if (m) return m[1];
  }
  return '';
}

/**
 * 统一鉴权判定：优先看 errno 白名单，再看文案正则。
 * 返回 { dead, errno, msg } —— dead 为 true 表示 Cookie 已失效。
 */
function detectAuthIssue(text, json) {
  const errno = pickNumber(text, json, ['errno', 'error_code']);
  const msg = pickString(text, json, ['error_msg', 'show_msg', 'errmsg']);
  const dead =
    (typeof errno === 'number' && AUTH_ERRNO.has(errno)) || COOKIE_DEAD_RE.test(msg);
  return { dead, errno, msg };
}

/** HTTP 非 200 时，尽量把响应体里的原因也带出来，别只丢一个状态码给用户 */
function failFromResponse(name, r) {
  const auth = detectAuthIssue(r.text, r.json);
  if (auth.dead) {
    return { name, ok: false, cookieDead: true, msg: auth.msg || `errno=${auth.errno}`, raw: r.text };
  }
  const code = pickNumber(r.text, r.json, ['error_code', 'errno']);
  const detail = [auth.msg, code !== undefined ? `error_code=${code}` : ''].filter(Boolean).join(' ').trim();
  const head = r.error || `HTTP ${r.status}`;
  return { name, ok: false, msg: detail ? `${head} · ${detail}` : head, raw: r.text };
}

async function request(url, cookie, opts = {}) {
  const { retries = 2, timeout = 15000 } = opts;
  const headers = { ...HEADERS, Cookie: cookie };
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    let timer = null;
    try {
      const ac = new AbortController();
      timer = setTimeout(() => ac.abort(), timeout);
      // 必须 manual：无权限时百度返回 302，自动跟随会让 undici 抛 terminated，
      // 而真正的错误信息就在 302 的响应体里（例如 {"error_code":36003,"error_msg":"no authority"}）
      const resp = await fetch(url, { headers, signal: ac.signal, redirect: 'manual' });
      const text = await resp.text();
      clearTimeout(timer);
      if (resp.status === 200) return { ok: true, status: resp.status, text, json: tryJson(text) };
      const location = resp.headers.get('location') || '';
      lastErr = location ? `HTTP ${resp.status} → ${location}` : `HTTP ${resp.status}`;
      return { ok: false, status: resp.status, text, json: tryJson(text), error: lastErr };
    } catch (e) {
      if (timer) clearTimeout(timer);
      lastErr = e.name === 'AbortError' ? `请求超时(${timeout}ms)` : e.message;
    }
  }
  return { ok: false, status: 0, text: '', json: null, error: lastErr || 'unknown' };
}

function appendLog(payload) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `signin-${today()}.log`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n', 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

// ---------------------------------------------------------------- 三个动作

async function doSignin(cookie, raw) {
  const r = await request(API.signin, cookie);
  if (raw) console.log('[raw] signin ->', r.status, r.text.slice(0, 800));
  if (!r.ok) return failFromResponse('签到', r);

  const auth = detectAuthIssue(r.text, r.json);
  if (auth.dead) {
    return { name: '签到', ok: false, cookieDead: true, msg: auth.msg || `errno=${auth.errno}`, raw: r.text };
  }

  const errorMsg = auth.msg;
  const errno = auth.errno;
  const points = pickNumber(r.text, r.json, ['points', 'point', 'score', 'sign_point']);

  // errno 存在且非 0 → 判定失败，但「已签到」要识别出来，不算事故
  if (typeof errno === 'number' && errno !== 0) {
    const already = ALREADY_ERRNO.has(errno) || ALREADY_RE.test(errorMsg);
    return {
      name: '签到',
      ok: already,
      already,
      msg: already ? '今日已签到（重复执行，忽略）' : `errno=${errno} ${errorMsg}`.trim(),
      raw: r.text,
    };
  }
  return {
    name: '签到',
    ok: true,
    msg: typeof points === 'number' ? `签到成功，获得积分 ${points}` : '签到成功（未返回积分）',
    points,
    raw: r.text,
  };
}

async function doQuestion(cookie, raw) {
  const q = await request(API.question, cookie);
  if (raw) console.log('[raw] getdailyquestion ->', q.status, q.text.slice(0, 800));
  if (!q.ok) return failFromResponse('答题', q);

  // 先鉴权：未登录时接口也会返回 200，但 errno 非 0，不能当成"今天没题"
  const auth = detectAuthIssue(q.text, q.json);
  if (auth.dead) {
    return { name: '答题', ok: false, cookieDead: true, msg: auth.msg || `errno=${auth.errno}` };
  }
  if (typeof auth.errno === 'number' && auth.errno !== 0) {
    return { name: '答题', ok: false, msg: `errno=${auth.errno} ${auth.msg}`.trim() };
  }

  const askId = pickNumber(q.text, q.json, ['ask_id', 'askId']);
  const answer = pickNumber(q.text, q.json, ['answer', 'right_answer', 'correct']);
  if (askId === undefined || answer === undefined) {
    return { name: '答题', ok: true, skipped: true, msg: '今日无可用题目或接口未返回答案，已跳过' };
  }

  const a = await request(API.answer(askId, answer), cookie);
  if (raw) console.log('[raw] answerquestion ->', a.status, a.text.slice(0, 800));
  if (!a.ok) return failFromResponse('答题', a);

  const errno = pickNumber(a.text, a.json, ['errno']);
  const showMsg = pickString(a.text, a.json, ['show_msg', 'error_msg', 'errmsg']);
  const score = pickNumber(a.text, a.json, ['score', 'points', 'point']);

  if (typeof errno === 'number' && errno !== 0) {
    const already = ALREADY_ERRNO.has(errno) || ALREADY_RE.test(showMsg);
    if (!already && COOKIE_DEAD_RE.test(showMsg)) {
      return { name: '答题', ok: false, cookieDead: true, msg: showMsg };
    }
    return { name: '答题', ok: already, already, msg: already ? '今日已答题（重复执行，忽略）' : `errno=${errno} ${showMsg}`.trim() };
  }
  return {
    name: '答题',
    ok: true,
    msg: typeof score === 'number' ? `答题成功，获得积分 ${score}` : `答题成功 ${showMsg}`.trim(),
    score,
  };
}

async function doUserInfo(cookie, raw) {
  const r = await request(API.user, cookie);
  if (raw) console.log('[raw] user ->', r.status, r.text.slice(0, 800));
  if (!r.ok) return failFromResponse('成长值', r);

  const auth = detectAuthIssue(r.text, r.json);
  if (auth.dead) {
    return { name: '成长值', ok: false, cookieDead: true, msg: auth.msg || `errno=${auth.errno}` };
  }

  const level = pickNumber(r.text, r.json, ['current_level', 'level', 'member_level']);
  const value = pickNumber(r.text, r.json, ['current_value', 'growth', 'growth_value', 'value']);
  if (level === undefined && value === undefined) {
    return { name: '成长值', ok: false, msg: '未能解析会员等级/成长值' };
  }
  return {
    name: '成长值',
    ok: true,
    msg: `会员等级 ${level ?? '未知'}，成长值 ${value ?? '未知'}`,
    level,
    growth: value,
  };
}

// ---------------------------------------------------------------- 主流程

function printGuide() {
  console.log(`
[×] 未找到百度网盘 Cookie，无法签到。

请按以下任一方式配置：

  方式 A（推荐，本机文件）
    1. 浏览器打开并登录：https://pan.baidu.com
    2. F12 → Network → 刷新页面 → 点任意 pan.baidu.com 请求 → Headers → Request Headers
    3. 复制 Cookie: 后那一整串（以 BDUSS= 开头的一长条）
    4. 写入文件：${COOKIE_FILE}
    5. 再次执行：node "${path.join(__dirname, 'signin.js')}"

  方式 B（环境变量，适合自动化场景）
    Windows PowerShell:  $env:BAIDU_PAN_COOKIE="BDUSS=xxx; ..."
    Linux/macOS:         export BAIDU_PAN_COOKIE="BDUSS=xxx; ..."

完整图文步骤见：${GUIDE_FILE}

[!] 注意：Cookie 等同于网盘账号登录凭证，请勿外传或提交到 Git。
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      `百度网盘每日签到 v${VERSION}\n` +
        `\n用法: node ${path.basename(__filename)} [选项]\n` +
        `  --json        机器可读输出\n` +
        `  --no-answer   跳过每日答题\n` +
        `  --raw         打印接口原始响应（排障用）\n` +
        `  --help        显示帮助\n`
    );
    return 0;
  }

  const jsonMode = argv.includes('--json');
  const rawMode = argv.includes('--raw');
  const doAnswer = !argv.includes('--no-answer');

  const { value: cookie, source } = readCookie();
  if (!cookie) {
    printGuide();
    appendLog({ event: 'no-cookie' });
    return 1;
  }
  if (!/BDUSS\s*=/.test(cookie)) {
    console.log('[!] Cookie 里没检测到 BDUSS= 字段，大概率是不完整的，签到会失败。');
  }

  const results = [];
  results.push(await doSignin(cookie, rawMode));
  await sleep(2500);
  if (doAnswer) results.push(await doQuestion(cookie, rawMode));
  await sleep(1500);
  results.push(await doUserInfo(cookie, rawMode));

  const cookieDead = results.some((r) => r.cookieDead);
  const failed = results.filter((r) => !r.ok && !r.cookieDead);
  const allOk = results.every((r) => r.ok);

  const summary = {
    date: today(),
    cookieSource: source,
    steps: results.map(({ raw, ...rest }) => rest),
    cookieDead,
    success: allOk,
  };
  appendLog(summary);

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\n百度网盘每日签到 — ${summary.date}\n${'-'.repeat(40)}`);
    for (const r of results) console.log(`${r.ok ? '[√]' : '[×]'} ${r.name}：${r.msg}`);
    console.log('-'.repeat(40));
    if (cookieDead) console.log('[!] Cookie 疑似失效，请重新抓取并更新 config/cookie.txt');
    else if (failed.length) console.log(`[!] 有 ${failed.length} 项未成功，建议带 --raw 重跑查看接口原文`);
    else console.log('[√] 全部完成');
  }

  return allOk ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[×] 未捕获异常：', e);
    appendLog({ event: 'crash', message: String(e && e.stack ? e.stack : e) });
    process.exit(1);
  });

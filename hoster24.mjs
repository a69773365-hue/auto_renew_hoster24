import { chromium } from "playwright";
import fs from "node:fs";

const SERVER_URL = process.env.HOSTER24_SERVER_URL || "https://hoster24.org/dashboard/server";
const COOKIE = (process.env.HOSTER24_COOKIE || "").trim();
const USER = process.env.HOSTER24_USERNAME || "";
const PASS = process.env.HOSTER24_PASSWORD || "";
const START_SELECTOR = process.env.HOSTER24_START_SELECTOR || ""; // 可选: 自定义 Start 按钮选择器
const DOMAIN = new URL(SERVER_URL).hostname.replace(/^www\./, "");

fs.mkdirSync("shots", { recursive: true });
const log = (...a) => console.log(new Date().toISOString(), ...a);

// 支持两种格式: Cookie-Editor 导出的 JSON 数组 / "a=1; b=2" 请求头字符串
function parseCookies(raw) {
  if (!raw) return [];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    let arr = JSON.parse(raw);
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map((c) => ({
      name: c.name,
      value: String(c.value),
      domain: c.domain || DOMAIN,
      path: c.path || "/",
      httpOnly: !!c.httpOnly,
      secure: c.secure ?? true,
      sameSite: { strict: "Strict", lax: "Lax" }[String(c.sameSite).toLowerCase()] || "None",
      ...(c.expirationDate ? { expires: Math.floor(c.expirationDate) } : {}),
    }));
  }
  return raw.split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return { name: p.slice(0, i), value: p.slice(i + 1), domain: DOMAIN, path: "/", secure: true, sameSite: "Lax" };
  });
}

const looksLikeLogin = async (page) =>
  /login|signin|sign-in|auth/i.test(page.url()) ||
  (await page.locator('input[type="password"]:visible').count()) > 0;

async function loginWithPassword(page) {
  log("使用账号密码登录");
  const user = page
    .locator('input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="login" i], input[type="text"]')
    .filter({ visible: true })
    .first();
  await user.fill(USER);
  await page.locator('input[type="password"]').filter({ visible: true }).first().fill(PASS);
  const btn = page
    .locator('button[type="submit"], input[type="submit"]')
    .or(page.getByRole("button", { name: /log\s?in|sign\s?in|登录/i }))
    .first();
  await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), btn.click()]);
  await page.waitForTimeout(3000);
}

const PROXY = process.env.HOSTER24_PROXY || ""; // 例: socks5://127.0.0.1:1080 (由工作流启动 sing-box 后注入)
if (PROXY) log("通过代理节点访问:", PROXY);
const browser = await chromium.launch({ headless: true, ...(PROXY ? { proxy: { server: PROXY } } : {}) });
const context = await browser.newContext({
  viewport: { width: 1366, height: 800 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
const page = await context.newPage();

try {
  const cookies = parseCookies(COOKIE);
  if (cookies.length) {
    await context.addCookies(cookies);
    log(`已注入 ${cookies.length} 个 cookie`);
  }

  await page.goto(SERVER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  if (await looksLikeLogin(page)) {
    if (!USER || !PASS) throw new Error("Cookie 已失效且未配置账号密码,请更新 HOSTER24_COOKIE");
    await loginWithPassword(page);
    await page.goto(SERVER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    if (await looksLikeLogin(page)) {
      await page.screenshot({ path: "shots/login-failed.png", fullPage: true });
      throw new Error("登录失败(可能有验证码 / Cloudflare 拦截),见 screenshots 工件");
    }
  }
  log("已登录:", page.url());
  await page.screenshot({ path: "shots/before.png", fullPage: true });

  const startBtns = START_SELECTOR
    ? page.locator(START_SELECTOR)
    : page
        .getByRole("button", { name: /^\s*(start|启动|开机)\s*$/i })
        .or(page.getByRole("link", { name: /^\s*(start|启动|开机)\s*$/i }))
        .or(page.locator("button:text-matches('^\\\\s*start\\\\s*$', 'i')"));

  const n = await startBtns.count();
  if (n === 0) {
    log("没找到 Start 按钮,服务器可能已在运行(或页面结构不同,请看 before.png)");
  } else {
    for (let i = 0; i < n; i++) {
      const b = startBtns.nth(i);
      if (await b.isVisible() && (await b.isEnabled())) {
        await b.click();
        log(`已点击 Start (${i + 1}/${n})`);
        await page.waitForTimeout(2000);
        // 有些面板会弹确认框
        const confirm = page.getByRole("button", { name: /^\s*(confirm|yes|ok|确定|确认)\s*$/i }).first();
        if (await confirm.isVisible().catch(() => false)) await confirm.click();
      }
    }
    await page.waitForTimeout(5000);
  }
  await page.screenshot({ path: "shots/after.png", fullPage: true });
  log("完成");
} catch (e) {
  console.error("ERROR:", e.message);
  await page.screenshot({ path: "shots/error.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

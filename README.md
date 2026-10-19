# hoster24auto_renew

用 GitHub Actions 每 12 小时自动登录 hoster24.org 并点击服务器的 **Start**,可选通过你导入的代理节点访问。

## 目录结构

```
.github/workflows/hoster24-auto-renew.yml   # 定时任务 (每12小时)
scripts/hoster24.mjs                        # Playwright: 登录 + 点击 Start
scripts/node2singbox.mjs                    # 节点链接 -> sing-box 配置
```

## 使用方法

1. 新建**私有**仓库,按上面的目录结构推上去。
2. Settings → Secrets and variables → Actions → **Secrets**:
   - `HOSTER24_COOKIE`:Cookie-Editor 导出的 JSON,或 `a=1; b=2` 字符串
   - `HOSTER24_USERNAME` / `HOSTER24_PASSWORD`:cookie 失效时回退到账号密码登录(两种方式至少填一种)
   - `HOSTER24_NODE`(可选):代理节点。不填则直连;填了则先在 runner 上启动 sing-box,浏览器走 `socks5://127.0.0.1:1080`
3. **Variables**(均可选):
   - `HOSTER24_SERVER_URL`:默认 `https://hoster24.org/dashboard/server`
   - `HOSTER24_START_SELECTOR`:Start 按钮的 CSS 选择器,自动识别失败时填写
   - `HOSTER24_NODE_INDEX`:`HOSTER24_NODE` 含多个节点(订阅)时使用第几个,从 0 开始,默认 0
4. Actions → hoster24auto_renew → **Run workflow** 手动跑一次验证,日志里会打印节点出口 IP。
5. 失败时查看运行详情里的 `screenshots` 工件(`before/after/error.png`)。

## HOSTER24_NODE 支持的格式

- 单个分享链接:`vmess://` `vless://`(含 Reality)`trojan://` `ss://` `hysteria2://` `hy2://`
- 多行链接、base64 订阅内容
- 订阅地址 `https://...`(运行时下载,取第 `HOSTER24_NODE_INDEX` 个)
- sing-box outbound 的 JSON(以 `{` 开头)

## 注意

- 节点链接含密钥,务必放在 Secrets 里,仓库设为私有。
- GitHub cron 可能延迟几分钟到半小时;公开仓库 60 天无提交会被停用定时任务。
- 有验证码 / Cloudflare 校验时,账号密码登录会失败,请依赖 cookie 并定期更新。cookie 往往与登录时的 IP 绑定,如果用了代理,建议在同一出口 IP 下获取 cookie,否则可能被判定失效。
- 请确认此类自动化不违反 hoster24 的服务条款。

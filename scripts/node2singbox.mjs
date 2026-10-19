// 把节点(分享链接 / 订阅链接 / base64 订阅 / sing-box outbound JSON)转成 sing-box 配置,输出到 stdout。
// 环境变量: HOSTER24_NODE (必填), HOSTER24_NODE_INDEX (默认 0), HOSTER24_PROXY_PORT (默认 1080)
const raw = (process.env.HOSTER24_NODE || "").trim();
const IDX = parseInt(process.env.HOSTER24_NODE_INDEX || "0", 10) || 0;
const PORT = parseInt(process.env.HOSTER24_PROXY_PORT || "1080", 10);

const b64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const isLink = (l) => /^(vmess|vless|trojan|ss|hysteria2|hy2):\/\//i.test(l);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const T = (v) => ["1", "true"].includes(String(v || "").toLowerCase());

async function loadLinks() {
  let text = raw;
  if (/^https?:\/\//i.test(text)) {
    const r = await fetch(text, { headers: { "user-agent": "sing-box" } });
    if (!r.ok) throw new Error(`订阅下载失败: HTTP ${r.status}`);
    text = (await r.text()).trim();
  }
  if (text.startsWith("{")) return [text];
  let lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.some(isLink)) {
    try { lines = b64(text.replace(/\s+/g, "")).split(/\r?\n/).map((s) => s.trim()).filter(Boolean); } catch {}
  }
  return lines.filter(isLink);
}

function tls(q, server, force = false) {
  const sec = q.get("security") || q.get("tls") || "";
  if (!force && !["tls", "reality", "1", "true"].includes(sec)) return undefined;
  const t = {
    enabled: true,
    server_name: q.get("sni") || q.get("peer") || q.get("host") || server,
    insecure: T(q.get("allowInsecure")) || T(q.get("insecure")),
  };
  if (q.get("alpn")) t.alpn = q.get("alpn").split(",");
  const fp = q.get("fp");
  if (fp || sec === "reality") t.utls = { enabled: true, fingerprint: fp || "chrome" };
  if (sec === "reality") t.reality = { enabled: true, public_key: q.get("pbk"), short_id: q.get("sid") || "" };
  return t;
}

function transport(q) {
  const type = q.get("type") || q.get("net") || "tcp";
  const path = dec(q.get("path") || "/");
  const host = q.get("host");
  if (type === "ws") return { type: "ws", path, headers: host ? { Host: host } : {} };
  if (type === "grpc") return { type: "grpc", service_name: q.get("serviceName") || q.get("path") || "" };
  if (type === "httpupgrade") return { type: "httpupgrade", path, host: host || undefined };
  if (type === "h2" || type === "http") return { type: "http", path, host: host ? host.split(",") : undefined };
  return undefined;
}

function parse(link) {
  if (link.startsWith("{")) return JSON.parse(link);
  const scheme = link.slice(0, link.indexOf(":")).toLowerCase();

  if (scheme === "vmess") {
    const j = JSON.parse(b64(link.slice(8)));
    const q = new URLSearchParams({
      type: j.net || "tcp", host: j.host || "", path: j.path || "/", sni: j.sni || "",
      alpn: j.alpn || "", fp: j.fp || "", security: j.tls === "tls" ? "tls" : "",
    });
    return {
      type: "vmess", server: j.add, server_port: Number(j.port), uuid: j.id,
      security: j.scy || "auto", alter_id: Number(j.aid || 0),
      tls: tls(q, j.add), transport: transport(q),
    };
  }

  if (scheme === "ss") {
    let body = link.slice(5).split("#")[0].split("?")[0];
    let method, password, host, port;
    if (body.includes("@")) {
      const at = body.lastIndexOf("@");
      let ui = body.slice(0, at);
      if (!ui.includes(":")) ui = b64(ui); else ui = dec(ui);
      [method, ...password] = ui.split(":"); password = password.join(":");
      [host, port] = splitHostPort(body.slice(at + 1));
    } else {
      const s = b64(body);
      const at = s.lastIndexOf("@");
      const ui = s.slice(0, at);
      [method, ...password] = ui.split(":"); password = password.join(":");
      [host, port] = splitHostPort(s.slice(at + 1));
    }
    return { type: "shadowsocks", server: host, server_port: Number(port), method, password };
  }

  const u = new URL(link);
  const q = u.searchParams;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const port = Number(u.port);

  if (scheme === "vless") {
    return {
      type: "vless", server: host, server_port: port, uuid: dec(u.username),
      flow: q.get("flow") || undefined, tls: tls(q, host), transport: transport(q),
    };
  }
  if (scheme === "trojan") {
    return {
      type: "trojan", server: host, server_port: port, password: dec(u.username),
      tls: tls(q, host, true), transport: transport(q),
    };
  }
  if (scheme === "hysteria2" || scheme === "hy2") {
    const o = {
      type: "hysteria2", server: host, server_port: port,
      password: dec(u.password ? `${u.username}:${u.password}` : u.username),
      tls: tls(q, host, true),
    };
    if (q.get("obfs")) o.obfs = { type: q.get("obfs"), password: q.get("obfs-password") || "" };
    return o;
  }
  throw new Error("不支持的协议: " + scheme);
}

function splitHostPort(s) {
  const m = s.match(/^\[?([^\]]+?)\]?:(\d+)$/);
  if (!m) throw new Error("无法解析 host:port");
  return [m[1], m[2]];
}

const clean = (o) => JSON.parse(JSON.stringify(o)); // 去掉 undefined

const links = await loadLinks();
if (!links.length) { console.error("没有解析到任何节点,请检查 HOSTER24_NODE"); process.exit(1); }
const link = links[IDX] ?? links[0];
console.error(`共解析到 ${links.length} 个节点,使用第 ${links[IDX] ? IDX : 0} 个`);

const outbound = { ...parse(link), tag: "proxy" };
console.log(JSON.stringify(clean({
  log: { level: "warn" },
  inbounds: [{ type: "socks", tag: "in", listen: "127.0.0.1", listen_port: PORT }],
  outbounds: [outbound, { type: "direct", tag: "direct" }],
  route: { final: "proxy" },
}), null, 2));

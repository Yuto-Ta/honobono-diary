// 管理画面の認証。設定に応じて次のどれかになる
//   1. Cloudflare Access … ACCESS_TEAM_DOMAIN と ACCESS_AUD を設定（カード登録が必要）
//   2. Basic 認証        … シークレット ADMIN_PASSWORD を登録（カード不要の代替）
//   3. どちらも未設定     … 管理画面を開かない（503）
import { basicAuth } from "hono/basic-auth";
import { MIN_ADMIN_PASSWORD } from "./config.js";

export async function adminAuth(c, next) {
  const team = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;

  if (team || aud) {
    const teamDomain = normalizeTeamDomain(team);
    if (!teamDomain || !aud) {
      console.error("ACCESS_TEAM_DOMAIN と ACCESS_AUD の両方を正しく設定してください", { team, hasAud: Boolean(aud) });
      return c.text("管理画面の認証設定（Access）が不完全です。README の手順を確認してください。", 503);
    }
    // Access を通ったリクエストには、Access が署名した JWT が付く。
    // ヘッダーは誰でも偽装できるので、署名・発行元・宛先・期限を検証してから信用する
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    const payload = token ? await verifyAccessJwt(token, teamDomain, aud).catch((err) => {
      console.error("Access の JWT を検証できませんでした", err);
      return null;
    }) : null;
    if (!payload) return c.text("ログインが必要です（Cloudflare Access）。", 403);
    c.set("adminUser", payload.email ?? payload.sub ?? "Access ユーザー");
    return next();
  }

  const password = c.env.ADMIN_PASSWORD;
  if (password) {
    if (password.length < MIN_ADMIN_PASSWORD) {
      console.error(`ADMIN_PASSWORD は ${MIN_ADMIN_PASSWORD} 文字以上にしてください`);
      return c.text("管理画面のパスワードが短すぎるため、管理画面を開けません。README の手順を確認してください。", 503);
    }
    return basicAuth({
      username: "admin",
      password,
      realm: "honobono-diary admin",
      onAuthSuccess: (c2) => c2.set("adminUser", "admin（Basic 認証）"),
    })(c, next);
  }

  return c.text("管理画面の認証が設定されていません。README の手順で Access か ADMIN_PASSWORD を設定してください。", 503);
}

// "myteam.cloudflareaccess.com" と "https://myteam.cloudflareaccess.com/" のどちらで書いても受け付ける
function normalizeTeamDomain(value) {
  if (!value) return null;
  const v = String(value).trim().replace(/\/+$/, "");
  const withScheme = v.startsWith("https://") ? v : `https://${v}`;
  return /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(withScheme) ? withScheme.toLowerCase() : null;
}

// ---- Access の JWT 検証（RS256・公開鍵は https://<チーム>.cloudflareaccess.com/cdn-cgi/access/certs）----

const KEY_CACHE_MS = 10 * 60 * 1000;
const KEY_REFETCH_MIN_MS = 30 * 1000;
let keyCache = { teamDomain: null, fetchedAt: 0, keys: new Map() };

async function verifyAccessJwt(token, teamDomain, aud) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const header = JSON.parse(b64urlToText(h));
  const payload = JSON.parse(b64urlToText(p));
  if (header.alg !== "RS256" || !header.kid) return null;

  const key = await getSigningKey(teamDomain, header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== teamDomain) return null;
  if (!auds.includes(aud)) return null; // 別の Access アプリ向けのトークンを使い回させない
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  return payload;
}

async function getSigningKey(teamDomain, kid) {
  const fresh = keyCache.teamDomain === teamDomain && Date.now() - keyCache.fetchedAt < KEY_CACHE_MS;
  if (fresh && keyCache.keys.has(kid)) return keyCache.keys.get(kid);
  // 鍵が入れ替わった直後に備えて、見つからなければ取り直す。
  // ただし偽の kid を大量に送られても取りに行き続けないよう、取り直しは 30 秒に1回まで
  const recentlyFetched = keyCache.teamDomain === teamDomain && Date.now() - keyCache.fetchedAt < KEY_REFETCH_MIN_MS;
  if (!fresh || !recentlyFetched) await refreshKeys(teamDomain);
  return keyCache.keys.get(kid) ?? null;
}

async function refreshKeys(teamDomain) {
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`公開鍵を取得できませんでした（HTTP ${res.status}）`);
  const { keys = [] } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    map.set(jwk.kid, await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    ));
  }
  keyCache = { teamDomain, fetchedAt: Date.now(), keys: map };
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

function b64urlToText(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

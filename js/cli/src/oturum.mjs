// Oturum ve API istemcisi. Giriş tarayıcıyla, cihaz onayıyla (RFC 8628): CLI kısa bir kod alır, portalın /cli sayfası açılır,
// geliştirici onaylar; CLI kısa ömürlü erişim jetonu + yenileme jetonu alır. Yenileme jetonu her kullanımda döner ve kasaya yazılır.
// Uçlar: /api/dev/cli/* (belge: https://developer.milofly.com/docs/cli).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform, release } from "node:os";
import * as kasa from "./kasa.mjs";
import { tarayiciAc, yaz, uyar } from "./arayuz.mjs";

/** Yayındaki Milofly API'si. Başka bir Milofly (yerel, prova) `--api` ya da MILOFLY_API_URL ile açıkça seçilir. */
export const URETIM_API = "https://api.milofly.com";
const PROFIL = join(kasa.KLASOR, "cli.json");
const SURUM = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export class ApiHatasi extends Error {
  constructor(durum, govde, mesaj) {
    super(mesaj);
    this.durum = durum;
    this.govde = govde;
    this.kod = govde?.code || govde?.error || null;
  }
}

/** Hangi API: bayrak > ortam değişkeni > son girişin profili. Hiçbiri yoksa giriş istenir (sessiz varsayılan yok). */
export function apiKoku(secenekler, { girisIcin = false } = {}) {
  const acik = secenekler.api || process.env.MILOFLY_API_URL;
  if (acik) return acik.replace(/\/+$/, "");
  if (existsSync(PROFIL)) return JSON.parse(readFileSync(PROFIL, "utf8")).api;
  if (girisIcin) return URETIM_API;
  throw new Error('Not signed in. Run "milofly login" first.');
}

function dil() {
  const d = (process.env.MILOFLY_LANG || Intl.DateTimeFormat().resolvedOptions().locale || "").slice(0, 2).toLowerCase();
  return d || null;
}

async function istek(api, yol, { method = "GET", govde, jeton } = {}) {
  const basliklar = { Accept: "application/json", "User-Agent": `milofly-cli/${SURUM} (${platform()} ${release()})` };
  // Çok parçalı form (paket varlığı yüklemesi): içerik türünü ve sınırı fetch kendisi yazar.
  const form = govde instanceof FormData;
  if (govde !== undefined && !form) basliklar["Content-Type"] = "application/json";
  if (jeton) basliklar.Authorization = `Bearer ${jeton}`;
  const d = dil();
  if (d) basliklar["X-Dev-Language"] = d;
  let yanit;
  try {
    yanit = await fetch(`${api}${yol}`, { method, headers: basliklar, body: govde === undefined ? undefined : form ? govde : JSON.stringify(govde) });
  } catch (hata) {
    throw new Error(`Cannot reach ${api}: ${hata.cause?.message ?? hata.message}`);
  }
  const metin = await yanit.text();
  let veri = null;
  try {
    veri = metin ? JSON.parse(metin) : null;
  } catch {
    veri = { raw: metin.slice(0, 500) };
  }
  return { durum: yanit.status, veri };
}

/** Kodlu API hatasının okunur metni: portalın kullandığı katalogdan (`/api/dev/api-messages/{kod}`), parametreler yerine konur. */
async function hataMetni(api, veri) {
  const kod = veri?.code;
  if (!kod || kod.includes(".")) return veri?.message || veri?.error || null;
  const r = await istek(api, `/api/dev/api-messages/${encodeURIComponent(kod)}`).catch(() => null);
  let metin = r?.durum === 200 ? r.veri?.message : null;
  if (metin && veri.params && typeof veri.params === "object")
    for (const [k, v] of Object.entries(veri.params)) metin = metin.replaceAll(`{${k}}`, String(v));
  return metin ? `${metin} (${kod})` : kod;
}

/** Oturumlu API istemcisi: erişim jetonu bitince yenilenir, yeni yenileme jetonu kasaya yazılır. */
export async function istemci(secenekler) {
  const api = apiKoku(secenekler);
  let kayit = kasa.oku(api);
  if (!kayit?.refreshToken) throw new Error(`Not signed in to ${api}. Run "milofly login${secenekler.api ? ` --api ${api}` : ""}".`);

  async function jeton() {
    if (kayit.accessToken && kayit.accessExpiresAt > Date.now() + 30_000) return kayit.accessToken;
    const r = await istek(api, "/api/dev/cli/token", { method: "POST", govde: { grantType: "refresh_token", refreshToken: kayit.refreshToken } });
    if (r.durum !== 200) {
      kasa.sil(api);
      throw new Error(`${(await hataMetni(api, r.veri)) ?? "The session has ended."} Run "milofly login" again.`);
    }
    kayit = oturumKaydi(r.veri, kayit.email);
    kasa.yaz(api, kayit);
    return kayit.accessToken;
  }

  async function cagir(yol, ayar = {}) {
    const r = await istek(api, yol, { ...ayar, jeton: await jeton() });
    if (r.durum >= 200 && r.durum < 300) return r.veri;
    throw new ApiHatasi(r.durum, r.veri, (await hataMetni(api, r.veri)) ?? `HTTP ${r.durum} on ${yol}`);
  }

  return { api, cagir, get eposta() { return kayit.email; } };
}

function oturumKaydi(veri, email) {
  return {
    accessToken: veri.access_token,
    accessExpiresAt: Date.now() + (veri.expires_in ?? 0) * 1000,
    refreshToken: veri.refresh_token,
    email: email ?? jetondakiEposta(veri.access_token),
  };
}

function jetondakiEposta(jwt) {
  try {
    const g = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return g.email ?? g["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ?? null;
  } catch {
    return null;
  }
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** `milofly login` */
export async function giris(secenekler) {
  const api = apiKoku(secenekler, { girisIcin: true });
  const istemciAdi = `milofly-cli ${SURUM} on ${platform()}`;
  const k = await istek(api, "/api/dev/cli/device", { method: "POST", govde: { clientName: istemciAdi } });
  if (k.durum !== 200) throw new Error(`Could not start sign-in on ${api}: ${(await hataMetni(api, k.veri)) ?? `HTTP ${k.durum}`}`);
  const { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval } = k.veri;

  yaz(`\nMilofly API: ${api}`);
  yaz(`Open ${verification_uri} and confirm this code:\n\n    ${user_code}\n`);
  if (!secenekler["no-browser"]) tarayiciAc(verification_uri_complete);

  let aralik = (interval ?? 5) * 1000;
  const bitis = Date.now() + (expires_in ?? 600) * 1000;
  while (Date.now() < bitis) {
    await bekle(aralik);
    const r = await istek(api, "/api/dev/cli/token", {
      method: "POST",
      govde: { grantType: "urn:ietf:params:oauth:grant-type:device_code", deviceCode: device_code },
    });
    if (r.durum === 200) {
      const kayit = oturumKaydi(r.veri);
      kasa.yaz(api, kayit);
      mkdirSync(kasa.KLASOR, { recursive: true, mode: 0o700 });
      writeFileSync(PROFIL, JSON.stringify({ api }, null, 2) + "\n");
      yaz(`Signed in as ${kayit.email ?? "developer"}. Credentials: ${kasa.konum()}.`);
      return;
    }
    const hata = r.veri?.error;
    if (hata === "authorization_pending") continue;
    if (hata === "slow_down") { aralik += 5000; continue; }
    if (hata === "access_denied") throw new Error("Sign-in was denied in the browser.");
    if (hata === "expired_token") break;
    throw new Error(`Sign-in failed: ${(await hataMetni(api, r.veri)) ?? hata ?? `HTTP ${r.durum}`}`);
  }
  throw new Error('The code expired before it was confirmed. Run "milofly login" again.');
}

/** `milofly logout` */
export async function cikis(secenekler) {
  const api = apiKoku(secenekler);
  const kayit = kasa.oku(api);
  if (kayit?.refreshToken)
    await istek(api, "/api/dev/cli/logout", { method: "POST", govde: { refreshToken: kayit.refreshToken } }).catch((h) => uyar(String(h.message)));
  kasa.sil(api);
  yaz(`Signed out of ${api}.`);
}

/** `milofly whoami` */
export async function kimim(secenekler) {
  const c = await istemci(secenekler);
  const r = await c.cagir("/api/dev/auth/me");
  const yayinci = await c.cagir("/api/dev/publisher");
  yaz(`${r.profile.email}${r.profile.fullName ? ` (${r.profile.fullName})` : ""}`);
  yaz(`API:           ${c.api}`);
  yaz(`Publisher key: ${yayinci.publisherKey ?? "(not chosen yet — choose it once in the portal › Themes)"}`);
}

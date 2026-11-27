#!/usr/bin/env node
// Dört JS SDK paketini yayın sırasıyla (theme-sdk → app-bridge → app-server → cli) hazırlar ve yayımlar. Elle koşulur; build'e/CI'a
// bağlı değildir.
//
//   node milofly.sdk/scripts/yayin.mjs                         kuru yayın: paketle + `npm publish --dry-run` (hiçbir şey yüklenmez)
//   node milofly.sdk/scripts/yayin.mjs --yayimla [--provenance] gerçek yayın (kayıt defterine yükler; geri alınamaz)
//   node scripts/yayin.mjs --yayimla --guvenilir               açık depodaki iş akışından (sdk-yayin.yml) npm güvenilir yayıncı
//                                                               (OIDC) ile gerçek yayın: npm oturumu ve jeton yoktur, provenance
//                                                               npm tarafından kendiliğinden eklenir (npm CLI ≥ 11.5.1, Node ≥ 22.14)
//
// Kapı (tek kaynak scripts/yayin-ayari.json): lisans, repository, homepage ya da bugs boşsa gerçek yayın YAPILMAZ. Kuru kipte kapı
// kapalıyken paketler deneme kipinde ("private": true) hazırlanır; kuru yayın paketin içeriğini gösterir, kapının durumunu yazar.
// Gerçek kipte ayrıca: npm oturumu açık olmalı (--guvenilir kipinde onun yerine GitHub Actions OIDC ortamı ve npm ≥ 11.5.1) ve
// sürüm notu hazır olmalı (surum-notu.mjs: "## <sürüm>" var, "(unreleased)" değil); biri tutmazsa hiçbir paket yüklenmez.
// Sürümü kayıt defterinde ZATEN olan paket atlanır (yayımlanan sürüm değişmez, üstüne yazılmaz): yarıda kalan yayın aynı komutla
// tamamlanır ve sahibin elle çıkardığı ilk sürümden sonra etiketle koşan iş akışı kırmızı düşmez. Hepsi yayındaysa hiçbir şey
// yüklenmez ve bu açıkça yazılır (sürümü artırmayı unutan etiket yayını sdk-yayin.yml'in etiket = sürüm denetiminde durur). --provenance
// yalnız herkese açık depodaki CI'da çalışır (npm kuralı). Güvenilir yayıncı npm'de paketin ayarından tanımlanır; paket kayıt defterinde
// yoksa ayar sayfası da yoktur, bu yüzden bir paketin İLK sürümü sahibin makinesinden --yayimla ile (2FA) çıkar.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { surumNotlariniDenetle } from "./surum-notu.mjs";
import { SDK_KOKU, YAYIN_SIRASI, yayinAyariniOku } from "./yayin-ayari.mjs";

const yayimla = process.argv.includes("--yayimla");
const provenance = process.argv.includes("--provenance");
const guvenilir = process.argv.includes("--guvenilir");
const SECENEKLER = ["--yayimla", "--provenance", "--guvenilir"];
const bilinmeyen = process.argv.slice(2).filter((a) => !SECENEKLER.includes(a));
if (bilinmeyen.length) throw new Error(`Bilinmeyen seçenek: ${bilinmeyen.join(" ")} (yalnız ${SECENEKLER.join(", ")}).`);
if ((provenance || guvenilir) && !yayimla) throw new Error("--provenance ve --guvenilir yalnız --yayimla ile anlamlıdır.");
if (provenance && guvenilir) throw new Error("--guvenilir kipinde provenance npm tarafından kendiliğinden eklenir; --provenance verilmez.");
/** Güvenilir yayıncının npm alt sınırı (https://docs.npmjs.com/trusted-publishers). */
const GUVENILIR_NPM_EN_AZ = [11, 5, 1];

/** npm'i çağırır. Windows'ta npm bir .cmd betiğidir; Node .cmd'yi yalnız kabukla çalıştırır, bu yüzden argümanlar tırnaklanır. */
function npm(argumanlar, { ciktiAl = false } = {}) {
  const pencere = process.platform === "win32";
  const sonuc = spawnSync(pencere ? "npm.cmd" : "npm", pencere ? argumanlar.map((a) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a)) : argumanlar, {
    shell: pencere,
    encoding: "utf8",
    stdio: ciktiAl ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (sonuc.error) throw new Error(`npm çalıştırılamadı: ${sonuc.error.message}`);
  return sonuc;
}

function paketle(ad, deneme) {
  const sonuc = spawnSync(process.execPath, [join(SDK_KOKU, "scripts", "paketle.mjs"), ad, ...(deneme ? ["--deneme"] : [])], {
    stdio: "inherit",
  });
  if (sonuc.status !== 0) throw new Error(`${ad}: paketle.mjs başarısız (çıkış ${sonuc.status}).`);
}

/** Kayıt defterinde bu sürüm var mı: var → true, yok (E404) → false; başka her hata görünür durur. */
function surumYayindaMi(adSurum) {
  const sonuc = npm(["view", adSurum, "version", "--json"], { ciktiAl: true });
  if (sonuc.status === 0) return sonuc.stdout.trim().length > 0;
  if (/E404|404 Not Found/.test(`${sonuc.stdout}\n${sonuc.stderr}`)) return false;
  throw new Error(`${adSurum}: kayıt defteri sorgulanamadı:\n${sonuc.stderr.trim()}`);
}

const ayar = yayinAyariniOku();
const kapiAcik = ayar.eksikler.length === 0;
if (yayimla && !kapiAcik) {
  throw new Error(`Yayın kapısı kapalı: scripts/yayin-ayari.json içinde boş alan: ${ayar.eksikler.join(", ")} (sahip kararı). Hiçbir paket yüklenmedi.`);
}
if (yayimla && guvenilir) {
  // OIDC jetonunu GitHub Actions verir; bu ortam değişkeni yalnız "id-token: write" izinli işte vardır.
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new Error("--guvenilir yalnız GitHub Actions'ta, \"permissions: id-token: write\" izinli işte çalışır (OIDC jetonu yok).");
  }
  const surum = npm(["--version"], { ciktiAl: true });
  const parca = surum.stdout.trim().split(/[.-]/).slice(0, 3).map(Number);
  const fark = GUVENILIR_NPM_EN_AZ.map((v, i) => Math.sign((parca[i] ?? 0) - v)).find((f) => f !== 0) ?? 0;
  if (surum.status !== 0 || parca.some(Number.isNaN) || fark < 0) {
    throw new Error(`Güvenilir yayıncı npm ${GUVENILIR_NPM_EN_AZ.join(".")} ya da üstünü ister; bu ortamda npm ${surum.stdout.trim() || "okunamadı"}.`);
  }
  console.log(`npm ${surum.stdout.trim()}: güvenilir yayıncı (OIDC) ile yayımlanacak.`);
} else if (yayimla) {
  const kim = npm(["whoami"], { ciktiAl: true });
  if (kim.status !== 0) throw new Error("npm oturumu yok: önce `npm login` (yayın hesabı ve 2FA sahipte).");
  console.log(`npm hesabı: ${kim.stdout.trim()}`);
}

console.log(`Yayın sırası: ${YAYIN_SIRASI.join(" → ")}`);
const paketler = [];
for (const ad of YAYIN_SIRASI) {
  paketle(ad, !kapiAcik);
  const dist = join(SDK_KOKU, "js", ad, "dist");
  const yayin = JSON.parse(readFileSync(join(dist, "package.json"), "utf8"));
  const adSurum = `${yayin.name}@${yayin.version}`;
  const yayinda = surumYayindaMi(adSurum);
  const kuru = npm(["publish", dist, "--dry-run", "--access", "public", "--json"], { ciktiAl: true });
  if (kuru.status !== 0) throw new Error(`${adSurum}: npm publish --dry-run başarısız:\n${kuru.stderr.trim()}`);
  const ozet = JSON.parse(kuru.stdout.slice(kuru.stdout.indexOf("{")));
  const kayit = ozet[yayin.name] ?? ozet;
  console.log(
    `  ${adSurum}: ${kayit.entryCount ?? kayit.files?.length} dosya, ${kayit.size} bayt (açık ${kayit.unpackedSize}); ` +
      `kayıt defterinde ${yayinda ? "VAR" : "yok"}; lisans ${yayin.license ?? "—"}${yayin.private ? "; private (deneme)" : ""}`,
  );
  paketler.push({ ad, dist, adSurum, yayinda, surum: yayin.version });
}

// Sürüm notu yüklemeden ÖNCE denetlenir (dört paket aynı sürümle çıkar; paketle.mjs iç bağımlılık sürümünü denetler).
const notSorunlari = [...new Set(paketler.map((p) => p.surum))].flatMap((s) => surumNotlariniDenetle(s));
if (notSorunlari.length) {
  const metin = `Sürüm notu hazır değil:\n  ${notSorunlari.join("\n  ")}`;
  if (yayimla) throw new Error(`${metin}\nHiçbir paket yüklenmedi.`);
  console.log(`${metin}\n  (gerçek yayından önce düzeltilmeli)`);
}

if (!yayimla) {
  console.log(
    kapiAcik
      ? "Kuru yayın tamam. Kapı açık: gerçek yayın için --yayimla."
      : `Kuru yayın tamam. Kapı KAPALI (boş: ${ayar.eksikler.join(", ")}) — paketler deneme kipinde hazırlandı, gerçek yayın yapılamaz.`,
  );
  process.exit(0);
}

const yuklenecek = paketler.filter((p) => !p.yayinda);
const atlanan = paketler.filter((p) => p.yayinda).map((p) => p.adSurum);
if (atlanan.length) console.log(`Kayıt defterinde zaten var, atlandı: ${atlanan.join(", ")}`);
if (!yuklenecek.length) {
  console.log("Yüklenecek paket yok: dört paketin bu sürümü zaten yayında. Yeni yayın için sürümü artırın.");
  process.exit(0);
}
const yayimlanan = [];
for (const { dist, adSurum } of yuklenecek) {
  const sonuc = npm(["publish", dist, "--access", "public", ...(provenance ? ["--provenance"] : [])]);
  if (sonuc.status !== 0) {
    throw new Error(
      `${adSurum} yayımlanamadı (çıkış ${sonuc.status}). Yayımlanan: ${yayimlanan.join(", ") || "yok"}. ` +
        "Yayımlanan sürümler geri alınmaz; sorunu giderip aynı komutu yeniden koşun (yayındaki paketler atlanır).",
    );
  }
  yayimlanan.push(adSurum);
}
console.log(`Yayımlandı: ${yayimlanan.join(", ")}`);

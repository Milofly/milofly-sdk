#!/usr/bin/env node
// SDK'yı herkese açık SDK deposunun düzeninde bir klasöre dışa aktarır (elle koşulur; build'e/CI'a bağlı değildir).
//
//   node milofly.sdk/scripts/disa-aktar.mjs <hedef-klasör>
//
// Açık depo (https://github.com/Milofly/milofly-sdk; adres scripts/yayin-ayari.json) yalnız SDK'yı ve onun kullandığı sözleşme
// dosyalarını taşır. Kaynak burada kalır; açık depo bu betiğin çıktısıdır. Düzen:
//   <kök>/js/<paket>/…, dotnet/…, ornekler/…, scripts/…, README.md, CHANGELOG.md, LICENSE   ← milofly.sdk (yayına girmeyen dosyalar hariç)
//   <kök>/package.json, .gitignore, .gitattributes, SECURITY.md, CONTRIBUTING.md, .github/…  ← milofly.sdk/acik-depo/ (yalnız açık depoda)
//   <kök>/shared/<yol>                                                                     ← milofly.shared sözleşmeleri (paylasilan.mjs)
// theme-sdk'nın sözleşme içe aktarmaları açık depo düzenine çevrilir (paketle.mjs iki düzende de aynı tanımdan okur).
// Paketlerin yayın adresi js/<paket>'tir (yayin-ayari.mjs → repository.directory); düzen bununla aynıdır.
//
// Kaynak git'te İZLENEN dosyalardır (git ls-files), çalışma ağacının taraması değil. SDK klasöründe ya da sözleşme dosyalarında
// commit'lenmemiş değişiklik veya izlenmeyen dosya varsa dışa aktarım yapılmaz: yerel .env, deneme klasörü ya da oturum dosyası
// açık depoya gidemez, açık depo her zaman bir commit'in kopyasıdır. İzlenen dosyalar arasında sır taşıyabilecek bir ad
// (.env*, *.pem, *.key, *.p12, *.pfx, *.log; .env.example serbest) varsa da durur.
//
// Hedef klasör silinip yeniden kurulur; içinde .git varsa yalnız .git korunur (açık deponun klonuna dışa aktarım). Yayın ayarı eksikse
// (lisans/adres boş) dışa aktarım yapılmaz: açık depo lisanssız yayımlanamaz. Gönderme (git push) bu betiğin işi değildir.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ACIK_DEPO_PAYLASILAN, SOZLESME_DOSYALARI, paylasilanKok, themeSdkGoreliYol } from "./paylasilan.mjs";
import { SDK_KOKU, YAYIN_SIRASI, yayinAyariniOku } from "./yayin-ayari.mjs";

const hedefArguman = process.argv[2];
if (!hedefArguman || process.argv.length > 3) throw new Error("Kullanım: node scripts/disa-aktar.mjs <hedef-klasör>");
const hedef = resolve(hedefArguman);
/** a, b'nin kendisi ya da içinde mi (başka sürücü → hayır). */
const icindeMi = (a, b) => {
  const r = relative(b, a);
  return !r || (!r.startsWith("..") && !isAbsolute(r));
};
if (icindeMi(hedef, SDK_KOKU) || icindeMi(SDK_KOKU, hedef)) throw new Error(`Hedef SDK klasörüyle iç içe olamaz: ${hedef}`);

const ayar = yayinAyariniOku();
if (ayar.eksikler.length) {
  throw new Error(`scripts/yayin-ayari.json içinde boş alan: ${ayar.eksikler.join(", ")} — açık depo lisans ve adresler yazılmadan dışa aktarılmaz.`);
}

/** git komutu SDK klasöründe; hata görünür, sessiz devam yok. */
const git = (...args) => execFileSync("git", args, { cwd: SDK_KOKU, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// 0) Kaynak temiz ve izleniyor mu.
const anaPaylasilan = paylasilanKok(SDK_KOKU);
const sozlesmeYollari = SOZLESME_DOSYALARI.map((d) => join(anaPaylasilan, d));
const kirli = git("status", "--porcelain", "--untracked-files=all", "--", ".", ...sozlesmeYollari).split("\n").filter(Boolean);
if (kirli.length) {
  throw new Error(`Commit'lenmemiş değişiklik ya da izlenmeyen dosya var; dışa aktarım commit'ten sonra yapılır:\n  ${kirli.join("\n  ")}`);
}
for (const yol of sozlesmeYollari) {
  if (!git("ls-files", "--", yol).trim()) throw new Error(`Sözleşme dosyası git'te izlenmiyor: ${yol}`);
}
/** SDK'nın izlenen dosyaları, SDK köküne göre ("/" ile). */
const izlenen = git("ls-files", "-z", "--", ".").split("\0").filter(Boolean);

/** Sır taşıyabilecek dosya adı: izlense bile açık depoya gitmez, dışa aktarım durur. */
const SIR_ADI = /^\.env(?!\.example$)(\..+)?$|\.(pem|key|p12|pfx|log)$/i;
const sirli = izlenen.filter((d) => SIR_ADI.test(d.split("/").pop()));
if (sirli.length) throw new Error(`Sır taşıyabilecek izlenen dosya var, dışa aktarılmaz:\n  ${sirli.join("\n  ")}`);

/**
 * Yayına girmeyen izlenen dosyalar: ana deponun .gitignore'u (yalnız dist kuralı; açık deponunki acik-depo/'dan gelir), derleme çıktısı
 * ve kanıt/deneme klasörleri, paket arşivleri.
 */
const ATLANAN_KLASOR = new Set(["node_modules", "dist", "bin", "obj", ".vs"]);
const atlanirMi = (dosya) => {
  if (dosya === ".gitignore") return true;
  if (dosya.split("/").some((p) => ATLANAN_KLASOR.has(p) || /^kan[iı]t/i.test(p))) return true;
  return /\.(tgz|nupkg)$/i.test(dosya);
};

// 1) Hedefi temizle (.git korunur).
if (existsSync(hedef)) {
  if (!statSync(hedef).isDirectory()) throw new Error(`Hedef bir klasör değil: ${hedef}`);
  for (const ad of readdirSync(hedef)) if (ad !== ".git") rmSync(join(hedef, ad), { recursive: true, force: true });
} else {
  mkdirSync(hedef, { recursive: true });
}

// 2) SDK kaynakları (izlenen dosyalar; acik-depo/ ayrı adımda).
const kopyalanan = new Set();
const acikDosyalar = [];
for (const dosya of izlenen) {
  if (dosya.startsWith("acik-depo/")) {
    acikDosyalar.push(dosya.slice("acik-depo/".length));
    continue;
  }
  if (atlanirMi(dosya)) continue;
  const varis = join(hedef, dosya);
  mkdirSync(dirname(varis), { recursive: true });
  cpSync(join(SDK_KOKU, dosya), varis);
  kopyalanan.add(dosya.split("/")[0]);
}

// 3) Yalnız açık depoda duran dosyalar; SDK kaynaklarının üstüne yazamaz (aynı gerçeğin iki sahibi olmaz).
if (!acikDosyalar.length) throw new Error("acik-depo/ içinde izlenen dosya yok.");
const acikDepo = join(SDK_KOKU, "acik-depo");
for (const dosya of acikDosyalar) {
  const varis = join(hedef, dosya);
  if (existsSync(varis)) throw new Error(`acik-depo/${dosya} SDK'daki bir dosyanın üstüne yazıyor.`);
  mkdirSync(dirname(varis), { recursive: true });
  cpSync(join(acikDepo, dosya), varis);
}

// 4) Sözleşme dosyaları ve theme-sdk'nın içe aktarma yolları.
const acikPaylasilan = join(hedef, ACIK_DEPO_PAYLASILAN);
const semaDosyasi = join(hedef, "js", "theme-sdk", "src", "component-schema.js");
let sema = readFileSync(semaDosyasi, "utf8");
for (const dosya of SOZLESME_DOSYALARI) {
  const varis = join(acikPaylasilan, dosya);
  mkdirSync(dirname(varis), { recursive: true });
  cpSync(join(anaPaylasilan, dosya), varis);
  const eski = themeSdkGoreliYol(anaPaylasilan, dosya, SDK_KOKU);
  const yeni = themeSdkGoreliYol(acikPaylasilan, dosya, hedef);
  if (eski === yeni) continue;
  if (!sema.includes(eski)) throw new Error(`component-schema.js: "${eski}" bulunamadı — içe aktarma yolu paylasilan.mjs ile uyuşmuyor.`);
  sema = sema.replaceAll(eski, yeni);
}
writeFileSync(semaDosyasi, sema);

// 5) Paket klasörleri yayın adresiyle (repository.directory = js/<paket>) aynı yerde mi.
for (const paket of YAYIN_SIRASI) {
  if (!existsSync(join(hedef, "js", paket, "package.json"))) throw new Error(`js/${paket}/package.json dışa aktarımda yok.`);
}

console.log(`Dışa aktarıldı → ${hedef}`);
console.log(`  SDK: ${[...kopyalanan].join(", ")}`);
console.log(`  açık depo: ${acikDosyalar.join(", ")}`);
console.log(`  sözleşmeler: ${SOZLESME_DOSYALARI.map((d) => `${ACIK_DEPO_PAYLASILAN}/${d}`).join(", ")}`);

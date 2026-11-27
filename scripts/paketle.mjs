#!/usr/bin/env node
// Bir JS SDK paketini yayına hazır dist/ klasörüne hazırlar (elle koşulur; build'e/CI'a bağlı değildir).
//
//   node milofly.sdk/scripts/paketle.mjs app-bridge | app-server | theme-sdk | cli  [--deneme]
//
// İki tür paket:
//   · TypeScript (exports .ts kaynağını gösterir: app-bridge, app-server): tsc ile dist/'e derlenir; exports ./src/*.ts → .js + .d.ts.
//   · JavaScript (exports .js/.mjs gösterir: theme-sdk, cli): src/ olduğu gibi kopyalanır; exports/bin değişmez. Depo içindeki tek kaynaklara
//     göreli içe aktarmalar (milofly.shared'in sözleşme dosyaları, ilk uygulama örneği) dist/vendor/ ve dist/templates/ altına
//     KOPYALANIR ve yolları oraya çevrilir — yayın paketi depo dışında çalışır, kaynak yine tek kalır.
// Çıktı: milofly.sdk/js/<paket>/dist/ — kod, README.md, CHANGELOG.md, LICENSE ve YAYIN package.json'u. dist/ commit'lenmez.
// Dört paketi sırasıyla hazırlayıp kuru (ya da gerçek) yayımlayan tek komut: scripts/yayin.mjs.
//
// Lisans ve adresler (repository, homepage, bugs) sahibin kararıdır ve TEK yerde durur: scripts/yayin-ayari.json. Kaynak
// package.json'lar bu alanları taşımaz (ikinci kaynak olur) ve hep "private": true kalır (çalışma alanı yanlışlıkla yayımlanmaz).
// Gerçek kipte ayarda boş alan varsa yayın paketi ÜRETİLMEZ; "private" yalnız bu kipte, yalnız dist/package.json'dan kalkar.
// --deneme yalnız paketin depo dışında çalıştığını denemek içindir: ayar eksik olabilir, çıktı "private": true yazılır.
// Eksik girdi (TypeScript bulunamadı, paket yok, iç bağımlılık sürümü uyuşmaz) görünür hatayla durur.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOZLESME_DOSYALARI, paylasilanKok, themeSdkGoreliYol } from "./paylasilan.mjs";
import { yayinAyariniOku, yayinMetaAlanlari } from "./yayin-ayari.mjs";

const sdkKoku = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ad = process.argv[2];
const deneme = process.argv.includes("--deneme");
if (!ad || ad.startsWith("--")) throw new Error("Paket adı verilmedi (app-bridge | app-server | theme-sdk | cli).");
const paketKoku = join(sdkKoku, "js", ad);
if (!existsSync(join(paketKoku, "package.json"))) throw new Error(`Paket bulunamadı: ${paketKoku}`);

const kaynak = JSON.parse(readFileSync(join(paketKoku, "package.json"), "utf8"));
if (kaynak.private !== true) {
  throw new Error(`${kaynak.name}: kaynak package.json "private": true taşımalı — yayın yalnız dist/ üzerinden yapılır.`);
}
const ikinciKaynak = ["license", "repository", "homepage", "bugs", "author"].filter((k) => k in kaynak);
if (ikinciKaynak.length) {
  throw new Error(`${kaynak.name}: package.json'da ${ikinciKaynak.join(", ")} var — bu alanların tek kaynağı scripts/yayin-ayari.json.`);
}
const ayar = yayinAyariniOku();
if (!deneme && ayar.eksikler.length) {
  throw new Error(
    `${kaynak.name}: scripts/yayin-ayari.json içinde boş alan: ${ayar.eksikler.join(", ")} — sahip kararı yazılmadan yayın paketi hazırlanmaz (deneme için --deneme).`,
  );
}
/** İç bağımlılık (@milofly/*) kardeş paketin sürümüyle birebir olmalı; aksi hâlde kayıt defterinde olmayan bir sürüme bağlanılır. */
function kardesSurumleriniDenetle(sahip, bagimliliklar) {
  for (const [bagimlilik, surum] of Object.entries(bagimliliklar ?? {})) {
    if (!bagimlilik.startsWith("@milofly/")) continue;
    const kardes = join(sdkKoku, "js", bagimlilik.slice("@milofly/".length), "package.json");
    if (!existsSync(kardes)) throw new Error(`${sahip}: ${bagimlilik} bu SDK'da yok.`);
    const kardesSurum = JSON.parse(readFileSync(kardes, "utf8")).version;
    if (surum !== kardesSurum) throw new Error(`${sahip}: ${bagimlilik} "${surum}" istiyor, kardeş paket ${kardesSurum}.`);
  }
}
kardesSurumleriniDenetle(kaynak.name, kaynak.dependencies);

const dist = join(paketKoku, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
// TypeScript paketi = dışa aktarımları .ts kaynağı gösteren paket (theme-sdk'nin tsconfig'i yalnız .d.ts denetimi içindir, derlemez).
const tsPaketi = Object.values(kaynak.exports).some((hedef) => typeof hedef === "string" && hedef.endsWith(".ts") && !hedef.endsWith(".d.ts"));

let disaAktar = kaynak.exports;
if (tsPaketi) {
  const require = createRequire(join(paketKoku, "package.json"));
  let tscYolu;
  try {
    tscYolu = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  } catch {
    throw new Error("TypeScript bulunamadı: new/ altında `npm install` koşulmuş olmalı (typescript kök node_modules'ta).");
  }
  const tsc = spawnSync(process.execPath, [tscYolu, "-p", join(paketKoku, "tsconfig.json"), "--outDir", dist], { stdio: "inherit" });
  if (tsc.status !== 0) throw new Error(`tsc başarısız (çıkış ${tsc.status}).`);
  disaAktar = {};
  for (const [yol, hedef] of Object.entries(kaynak.exports)) {
    const temel = hedef.replace(/^\.\/src\//, "./").replace(/\.ts$/, "");
    disaAktar[yol] = { types: `${temel}.d.ts`, import: `${temel}.js` };
  }
} else {
  cpSync(join(paketKoku, "src"), join(dist, "src"), { recursive: true });
}

/** dist/src içindeki bir dosyada depo-göreli yolu dist içindeki kopyaya çevirir; eşleşme yoksa durur (tarif eskidi). */
function yolCevir(dosya, eski, yeni) {
  const tam = join(dist, "src", dosya);
  const metin = readFileSync(tam, "utf8");
  if (!metin.includes(eski)) throw new Error(`${dosya}: "${eski}" bulunamadı — paketle.mjs'deki tarif kaynakla uyuşmuyor.`);
  writeFileSync(tam, metin.replaceAll(eski, yeni));
}

if (ad === "theme-sdk") {
  // Bileşen şema sözleşmesinin tek kaynağı milofly.shared'dedir (açık depoda kopyası shared/'dadır; yer: paylasilan.mjs); yayın
  // paketine dist/vendor/ altında kopyası girer.
  const paylasilan = paylasilanKok(sdkKoku);
  mkdirSync(join(dist, "vendor"), { recursive: true });
  for (const dosya of SOZLESME_DOSYALARI) {
    cpSync(join(paylasilan, dosya), join(dist, "vendor", basename(dosya)));
    yolCevir("component-schema.js", themeSdkGoreliYol(paylasilan, dosya, sdkKoku), `../vendor/${basename(dosya)}`);
  }
}
if (ad === "cli") {
  // `milofly app init`'in şablonu ilk uygulama örneğidir (tek kaynak); yayın paketine kopyası girer. Şablonun @milofly/* bağımlılıkları
  // aynı SDK sürümündeki kardeş paketlerle birebir olmalı, yoksa geliştiricinin `npm install`'ı kayıt defterinde olmayan sürümü arar.
  const sablon = JSON.parse(readFileSync(join(sdkKoku, "ornekler", "ilk-uygulama", "package.json"), "utf8"));
  kardesSurumleriniDenetle("ilk-uygulama şablonu", sablon.dependencies);
  const atlanan = new Set(["node_modules", "dist", ".env"]);
  cpSync(join(sdkKoku, "ornekler", "ilk-uygulama"), join(dist, "templates", "first-app"), {
    recursive: true,
    filter: (yol) => !atlanan.has(basename(yol)),
  });
  yolCevir("sablon-yolu.mjs", '"../../../ornekler/ilk-uygulama/"', '"../templates/first-app/"');
}

const yayin = {
  name: kaynak.name,
  version: kaynak.version,
  description: kaynak.description,
  ...yayinMetaAlanlari(ayar, ad),
  ...(deneme ? { private: true } : {}),
  type: "module",
  ...(kaynak.sideEffects === false ? { sideEffects: false } : {}),
  ...(kaynak.engines ? { engines: kaynak.engines } : {}),
  // npm bin yolunu "./" önekisiz yazar (önekli yolu düzeltip uyarır).
  ...(kaynak.bin ? { bin: Object.fromEntries(Object.entries(kaynak.bin).map(([k, v]) => [k, v.replace(/^\.\//, "")])) } : {}),
  exports: disaAktar,
  ...(kaynak.dependencies ? { dependencies: kaynak.dependencies } : {}),
  publishConfig: { access: "public" },
};
writeFileSync(join(dist, "package.json"), JSON.stringify(yayin, null, 2) + "\n");
for (const dosya of ["README.md", "CHANGELOG.md"]) cpSync(join(paketKoku, dosya), join(dist, dosya));
// Lisans metni SDK kökündeki tek LICENSE dosyasıdır; her yayın paketine kopyası girer.
cpSync(join(sdkKoku, "LICENSE"), join(dist, "LICENSE"));
console.log(`${kaynak.name}@${kaynak.version} → ${dist}${deneme ? " (deneme: private, yayımlanamaz)" : ""}`);

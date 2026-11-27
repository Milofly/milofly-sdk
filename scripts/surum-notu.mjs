#!/usr/bin/env node
// Sürüm notu denetimi: yayımlanacak sürümün başlığı kök CHANGELOG.md'de ve her JS paketinin CHANGELOG.md'sinde (npm paketine girer)
// "## <sürüm>" olarak var mı ve hâlâ "(unreleased)" mı. Yayımlanan paket değiştirilemediği için "unreleased" yazan not ile yayın
// yapılmaz. Tek tanım burasıdır: yayin.mjs (gerçek yayında durur, kuru yayında yazar) ve sdk-yayin.yml (NuGet dahil her iş) okur.
//
//   node scripts/surum-notu.mjs <sürüm>     sorun varsa yazar ve 1 ile çıkar
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SDK_KOKU, YAYIN_SIRASI } from "./yayin-ayari.mjs";

const kacir = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sorunların listesi (boş = hazır). */
export function surumNotlariniDenetle(surum) {
  const dosyalar = ["CHANGELOG.md", ...YAYIN_SIRASI.map((p) => `js/${p}/CHANGELOG.md`)];
  const sorunlar = [];
  for (const dosya of dosyalar) {
    const yol = join(SDK_KOKU, dosya);
    if (!existsSync(yol)) {
      sorunlar.push(`${dosya}: yok`);
      continue;
    }
    const baslik = readFileSync(yol, "utf8").match(new RegExp(`^##\\s+v?${kacir(surum)}(?![\\w.-])(.*)$`, "m"));
    if (!baslik) sorunlar.push(`${dosya}: "## ${surum}" başlığı yok`);
    else if (/unreleased/i.test(baslik[1])) sorunlar.push(`${dosya}: "## ${surum}" hâlâ "(unreleased)"; yayın tarihini yazın`);
  }
  return sorunlar;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const surum = process.argv[2];
  if (!surum || process.argv.length > 3) throw new Error("Kullanım: node scripts/surum-notu.mjs <sürüm>");
  const sorunlar = surumNotlariniDenetle(surum);
  if (sorunlar.length) {
    console.error(`Sürüm notu hazır değil (${surum}):\n  ${sorunlar.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Sürüm notu hazır: ${surum}`);
}

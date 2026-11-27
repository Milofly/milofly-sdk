// SDK yayın ayarının okuyucusu (tek kaynak: yayin-ayari.json). paketle.mjs ve yayin.mjs yalnız buradan okur; .NET paketi
// (Milofly.Apps.csproj) aynı JSON dosyasını kendisi okur. Değer uydurulmaz: boş alan "eksik" sayılır ve gerçek yayın kapısı kapanır.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SDK_KOKU = join(dirname(fileURLToPath(import.meta.url)), "..");
export const AYAR_YOLU = join(SDK_KOKU, "scripts", "yayin-ayari.json");

/** npm yayın sırası: bağımlılığı olan paket, bağımlı olduğu paketten SONRA çıkar (cli → theme-sdk). */
export const YAYIN_SIRASI = Object.freeze(["theme-sdk", "app-bridge", "app-server", "cli"]);

const ALANLAR = ["license", "repository", "homepage", "bugs"];
// SPDX lisans ifadesi (MIT, Apache-2.0, "MIT OR Apache-2.0"); npm ve NuGet (PackageLicenseExpression) ikisi de bunu ister.
const SPDX = /^\(?[A-Za-z0-9.+-]+\)?(\s+(AND|OR|WITH)\s+\(?[A-Za-z0-9.+-]+\)?)*$/;

/**
 * Ayarı okur ve biçimini denetler. Dönen `eksikler` boşsa gerçek yayın yapılabilir.
 * Biçim hatası (bilinmeyen anahtar, metin olmayan değer, https olmayan adres, SPDX olmayan lisans) her kipte hatadır.
 */
export function yayinAyariniOku() {
  let ayar;
  try {
    ayar = JSON.parse(readFileSync(AYAR_YOLU, "utf8"));
  } catch (hata) {
    throw new Error(`${AYAR_YOLU} okunamadı: ${hata.message}`);
  }
  const bilinmeyen = Object.keys(ayar).filter((k) => k !== "_not" && !ALANLAR.includes(k));
  if (bilinmeyen.length) throw new Error(`${AYAR_YOLU}: bilinmeyen alan: ${bilinmeyen.join(", ")}.`);
  const eksikler = [];
  for (const alan of ALANLAR) {
    if (typeof ayar[alan] !== "string") throw new Error(`${AYAR_YOLU}: "${alan}" metin olmalı (boş bırakılabilir).`);
    const deger = ayar[alan].trim();
    if (!deger) {
      eksikler.push(alan);
      continue;
    }
    if (alan === "license") {
      if (!SPDX.test(deger)) throw new Error(`${AYAR_YOLU}: "license" bir SPDX ifadesi olmalı (ör. MIT); "${deger}" değil.`);
    } else {
      let adres;
      try {
        adres = new URL(deger);
      } catch {
        throw new Error(`${AYAR_YOLU}: "${alan}" geçerli bir adres değil: "${deger}".`);
      }
      if (adres.protocol !== "https:") throw new Error(`${AYAR_YOLU}: "${alan}" https adresi olmalı: "${deger}".`);
    }
  }
  return {
    license: ayar.license.trim(),
    repository: ayar.repository.trim(),
    homepage: ayar.homepage.trim(),
    bugs: ayar.bugs.trim(),
    eksikler,
  };
}

/** Yayın package.json'una giren meta alanlar; yalnız dolu olanlar yazılır (deneme kipinde ayar yarım olabilir). */
export function yayinMetaAlanlari(ayar, paketAdi) {
  return {
    ...(ayar.license ? { license: ayar.license } : {}),
    ...(ayar.homepage ? { homepage: ayar.homepage } : {}),
    // npm adresi "git+https://….git" biçimine kendisi çevirir ve uyarır; aynı biçim burada yazılır (provenance adresi de budur).
    ...(ayar.repository
      ? { repository: { type: "git", url: `git+${ayar.repository.replace(/\.git$/, "")}.git`, directory: `js/${paketAdi}` } }
      : {}),
    ...(ayar.bugs ? { bugs: { url: ayar.bugs } } : {}),
  };
}

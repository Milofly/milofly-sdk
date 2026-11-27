// SDK paketlerinin kullandığı platform sözleşme dosyalarının yeri (tek tanım). paketle.mjs ve disa-aktar.mjs yalnız buradan okur.
//
// Sözleşmelerin tek kaynağı platformun `milofly.shared` paketidir. İki düzen vardır:
//   · ana depo: SDK `new/milofly.sdk`'dadır, sözleşmeler komşu `new/milofly.shared`'dedir;
//   · herkese açık SDK deposu (disa-aktar.mjs çıktısı): sözleşmelerin kopyası depo kökündeki `shared/` klasöründedir (aynı alt yollarla).
// Düzen tahmin edilmez: SDK kökünde `shared/` varsa açık depo düzenidir, yoksa ana depo düzenidir; ikisi de yoksa görünür hata.
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { SDK_KOKU } from "./yayin-ayari.mjs";

/** Açık depoda sözleşme kopyalarının klasörü (SDK köküne göre). */
export const ACIK_DEPO_PAYLASILAN = "shared";

/** SDK'nın kullandığı sözleşme dosyaları, `milofly.shared` köküne göre. Yeni bir sözleşme dosyası SDK'ya girerse buraya eklenir. */
export const SOZLESME_DOSYALARI = Object.freeze(["scripts/component-contracts.mjs", "src/dinamik-alan-sozlesmesi.json"]);

/** theme-sdk'nın sözleşmeleri içe aktaran kaynak klasörü (göreli yolların başlangıcı). */
const THEME_SDK_SRC = join("js", "theme-sdk", "src");

/** Verilen SDK kökünde sözleşmelerin bulunduğu klasör. */
export function paylasilanKok(sdkKoku = SDK_KOKU) {
  const acik = join(sdkKoku, ACIK_DEPO_PAYLASILAN);
  if (existsSync(acik)) return acik;
  const ana = join(sdkKoku, "..", "milofly.shared");
  if (existsSync(join(ana, "package.json"))) return ana;
  throw new Error(`Sözleşme dosyaları bulunamadı: ne ${acik} ne ${ana} var.`);
}

/** theme-sdk/src içinden bir sözleşme dosyasının göreli içe aktarma yolu ("../../../shared/scripts/…" gibi, her zaman / ile). */
export function themeSdkGoreliYol(paylasilan, dosya, sdkKoku = SDK_KOKU) {
  return `${relative(join(sdkKoku, THEME_SDK_SRC), paylasilan).replaceAll("\\", "/")}/${dosya}`;
}

// @milofly/theme-sdk/component-schema — bileşen şema sözleşmesinin (schema.json) doğrulayıcıları.
//
// TEK KAYNAK: kuralların sahibi platformun bileşen sözleşmesidir (scripts/component-contracts.mjs; platformun kendi bileşenleri
// aynı fonksiyonlardan geçer). Burada kopya YOK: kaynakta o dosya doğrudan içe aktarılır; yayın paketinde paketle.mjs
// aynı dosyayı dist/vendor/ altına kopyalar ve bu içe aktarmayı oraya çevirir. Dinamik alan sözleşmesi de aynı yoldan gelir.
//
// Not: dış geliştiricinin KOD bileşeni yüklemesi henüz açık değil (geliştirici platformu G6). Bu doğrulayıcılar şemayı yerelde
// denetlemek ve platformun bileşen sözleşmesini öğrenmek içindir.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export {
  collectSchemaLabelReferences,
  expandSchemaFragments,
  indexSchemaFragments,
  validateActiveLanguageCoverage,
  validateDynamicFieldDeclarations,
  validateSchemaFragments,
} from "../../../shared/scripts/component-contracts.mjs";

const SOZLESME_YOLU = new URL("../../../shared/src/dinamik-alan-sozlesmesi.json", import.meta.url);

/** Dinamik alan sözleşmesi (jeton deseni, yerel ad alanı, metin alan türleri) — `validateDynamicFieldDeclarations`'ın girdisi. */
export const dynamicFieldContract = Object.freeze(JSON.parse(readFileSync(fileURLToPath(SOZLESME_YOLU), "utf8")));

/** Yazım yardımcısı: şemayı olduğu gibi döner; editörde tip denetimi ve tamamlama içindir. */
export function defineComponentSchema(schema) {
  return schema;
}

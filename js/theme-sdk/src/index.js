// @milofly/theme-sdk — çalışma zamanı. Tipler: index.d.ts. Sıfır bağımlılık (node:fs, node:path).
//
// Bu paket kural KOYMAZ: bileşen anahtarı, ayar, sunum, tarafsızlık, dil ve özel CSS kurallarının tek sahibi Milofly API'sidir
// (sürüm yazıcısı ve kurulumla aynı doğrulayıcı; CLI `theme check` onu çağırır). Burada yalnız iki iş var:
//   1. manifesti incelenebilir bir klasör olarak yazıp geri okumak (sayfa ve ayar başına bir dosya, kararlı JSON);
//   2. tip düzeyinde biçim denetimi (sunucuya göndermeden önce bozuk JSON'u yakalar; kural denetimi değildir).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PROJECT_LAYOUT = Object.freeze({
  root: "theme",
  package: "theme/package.json",
  theme: "theme/theme.json",
  pages: "theme/pages",
  layouts: "theme/layouts.json",
  settings: "theme/settings",
  offerings: "theme/offerings.json",
  /** The package's own icons and fonts: the list (path, kind, font face or icon tint, licence) — optional. */
  assets: "theme/assets.json",
  /** The files themselves: theme/assets/icons/<name>.svg|png, theme/assets/fonts/<name>.woff2. */
  assetFiles: "theme/assets",
});

const DOSYA_ADI = /^[A-Za-z0-9._-]+$/;

function nesneMi(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function yaz(dosya, deger) {
  return writeFile(dosya, JSON.stringify(deger, null, 2) + "\n", "utf8");
}

async function oku(dosya) {
  let metin;
  try {
    metin = await readFile(dosya, "utf8");
  } catch (hata) {
    throw new Error(`${dosya}: ${hata.code === "ENOENT" ? "missing" : hata.message}`);
  }
  try {
    return JSON.parse(metin);
  } catch (hata) {
    throw new Error(`${dosya}: invalid JSON (${hata.message})`);
  }
}

function dosyaAdi(anahtar, ne) {
  if (typeof anahtar !== "string" || !DOSYA_ADI.test(anahtar))
    throw new Error(`${ne} key "${anahtar}" cannot be used as a file name (allowed: letters, digits, . _ -).`);
  return `${anahtar}.json`;
}

/** @param {string} kok @param {any} manifest */
export async function writeThemeProject(kok, manifest) {
  const sorunlar = checkManifestShape(manifest);
  if (sorunlar.length > 0)
    throw new Error(`Manifest shape is invalid:\n${sorunlar.map((s) => `  ${s.path}: ${s.detail}`).join("\n")}`);

  // Varlık listesi (assets) yerelde yaşar: dosyalar klasördedir, sunucu onları geri vermez. Çekilen manifest yerel listeyi ezmez.
  const { theme, offerings, assets: _assets, ...paket } = manifest;
  const { pages, layouts, settings, ...tema } = theme;
  const yazilan = [];
  const yol = (goreli) => {
    yazilan.push(goreli);
    return join(kok, goreli);
  };

  await mkdir(join(kok, PROJECT_LAYOUT.pages), { recursive: true });
  await mkdir(join(kok, PROJECT_LAYOUT.settings), { recursive: true });
  await yaz(yol(PROJECT_LAYOUT.package), paket);
  await yaz(yol(PROJECT_LAYOUT.theme), tema);
  await yaz(yol(PROJECT_LAYOUT.layouts), layouts);
  await yaz(yol(PROJECT_LAYOUT.offerings), offerings);

  const sayfaDosyalari = new Set();
  for (const sayfa of pages) {
    const ad = dosyaAdi(sayfa.systemPageKey, "Page");
    if (sayfaDosyalari.has(ad)) throw new Error(`Page "${sayfa.systemPageKey}" appears twice in the manifest.`);
    sayfaDosyalari.add(ad);
    await yaz(yol(`${PROJECT_LAYOUT.pages}/${ad}`), sayfa);
  }
  const ayarDosyalari = new Set();
  for (const ayar of settings) {
    const ad = dosyaAdi(ayar.key, "Setting");
    if (ayarDosyalari.has(ad)) throw new Error(`Setting "${ayar.key}" appears twice in the manifest.`);
    ayarDosyalari.add(ad);
    await yaz(yol(`${PROJECT_LAYOUT.settings}/${ad}`), ayar);
  }
  // Manifestte artık olmayan sayfa/ayar dosyası kalırsa geri okumada pakete geri girerdi: silinir.
  for (const [klasor, tutulan] of [[PROJECT_LAYOUT.pages, sayfaDosyalari], [PROJECT_LAYOUT.settings, ayarDosyalari]])
    for (const ad of await readdir(join(kok, klasor)))
      if (ad.endsWith(".json") && !tutulan.has(ad)) await rm(join(kok, klasor, ad));
  return yazilan;
}

/** @param {string} kok */
export async function readThemeProject(kok) {
  const paket = await oku(join(kok, PROJECT_LAYOUT.package));
  const tema = await oku(join(kok, PROJECT_LAYOUT.theme));
  const layouts = await oku(join(kok, PROJECT_LAYOUT.layouts));
  const offerings = await oku(join(kok, PROJECT_LAYOUT.offerings));

  const pages = [];
  for (const ad of (await readdir(join(kok, PROJECT_LAYOUT.pages))).filter((a) => a.endsWith(".json")).sort())
    pages.push(await oku(join(kok, PROJECT_LAYOUT.pages, ad)));
  // Sayfa sırası sayfanın kendi sortOrder'ıdır; eşitlikte anahtar (kararlı).
  pages.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.systemPageKey).localeCompare(String(b.systemPageKey)));

  const settings = [];
  for (const ad of (await readdir(join(kok, PROJECT_LAYOUT.settings))).filter((a) => a.endsWith(".json")).sort())
    settings.push(await oku(join(kok, PROJECT_LAYOUT.settings, ad)));

  const manifest = { ...paket, theme: { ...tema, pages, layouts, settings }, offerings };
  const varliklar = await readThemeAssets(kok);
  if (varliklar) manifest.assets = varliklar;
  const sorunlar = checkManifestShape(manifest);
  if (sorunlar.length > 0)
    throw new Error(`Theme project shape is invalid:\n${sorunlar.map((s) => `  ${s.path}: ${s.detail}`).join("\n")}`);
  return manifest;
}

/**
 * The package's own icons and fonts: `theme/assets.json` (optional) + the files under `theme/assets/`. Every entry gets the SHA-256
 * of its file (the API matches the uploaded file by this digest). Returns `null` when the package has no assets.
 * @param {string} kok
 */
export async function readThemeAssets(kok) {
  const liste = join(kok, PROJECT_LAYOUT.assets);
  if (!existsSync(liste)) return null;
  const ham = await oku(liste);
  if (!nesneMi(ham) || !Array.isArray(ham.files)) throw new Error(`${liste}: must be { "files": [ ... ] }`);
  const files = [];
  for (const [i, f] of ham.files.entries()) {
    if (!nesneMi(f) || typeof f.path !== "string") throw new Error(`${liste}: files[${i}].path must be a string`);
    const dosya = assetFilePath(kok, f.path);
    let icerik;
    try {
      icerik = await readFile(dosya);
    } catch (hata) {
      throw new Error(`${dosya}: ${hata.code === "ENOENT" ? "missing" : hata.message}`);
    }
    const { sha256: _yazilan, ...kalan } = f;
    files.push({ ...kalan, sha256: createHash("sha256").update(icerik).digest("hex") });
  }
  return { files };
}

/** Absolute path of an asset file (`icons/cart.svg` -> `<project>/theme/assets/icons/cart.svg`). Rejects paths leaving the folder.
 * @param {string} kok @param {string} yol */
export function assetFilePath(kok, yol) {
  if (typeof yol !== "string" || yol.includes("..") || yol.startsWith("/") || yol.includes("\\"))
    throw new Error(`Asset path "${yol}" must be relative (icons/<name> or fonts/<name>).`);
  return join(kok, PROJECT_LAYOUT.assetFiles, ...yol.split("/"));
}

/** @param {unknown} m */
export function checkManifestShape(m) {
  const s = [];
  const ekle = (path, detail) => s.push({ code: "local.shape", path, detail });
  if (!nesneMi(m)) {
    ekle("", "manifest must be a JSON object");
    return s;
  }
  for (const alan of ["packageKey", "version", "mode", "localizationMode", "defaultLanguageCode"])
    if (typeof m[alan] !== "string") ekle(alan, "must be a string");
  if (typeof m.schemaVersion !== "number") ekle("schemaVersion", "must be a number");
  if (!Array.isArray(m.supportedLanguageCodes) || m.supportedLanguageCodes.some((d) => typeof d !== "string"))
    ekle("supportedLanguageCodes", "must be an array of language codes");
  if (!nesneMi(m.catalogTranslations)) ekle("catalogTranslations", "must be an object keyed by language");
  if (!nesneMi(m.offerings) || !nesneMi(m.offerings.surfaces)) ekle("offerings.surfaces", "must be an object keyed by surface");
  else
    for (const [yuzey, ogeler] of Object.entries(m.offerings.surfaces))
      if (!Array.isArray(ogeler)) ekle(`offerings.surfaces.${yuzey}`, "must be an array");
  const t = m.theme;
  if (!nesneMi(t)) {
    ekle("theme", "must be an object");
    return s;
  }
  for (const [alan, ne] of [["pages", "page"], ["layouts", "layout"], ["settings", "setting"]])
    if (!Array.isArray(t[alan])) ekle(`theme.${alan}`, `must be an array of ${ne}s`);
  (Array.isArray(t.pages) ? t.pages : []).forEach((p, i) => {
    if (!nesneMi(p)) return ekle(`theme.pages[${i}]`, "must be an object");
    if (typeof p.systemPageKey !== "string") ekle(`theme.pages[${i}].systemPageKey`, "must be a string");
    if (!Array.isArray(p.components)) ekle(`theme.pages[${i}].components`, "must be an array");
    else
      p.components.forEach((c, j) => {
        if (!nesneMi(c) || typeof c.componentKey !== "string")
          ekle(`theme.pages[${i}].components[${j}].componentKey`, "must be a string");
      });
  });
  (Array.isArray(t.layouts) ? t.layouts : []).forEach((l, i) => {
    if (!nesneMi(l) || typeof l.componentKey !== "string" || typeof l.layoutType !== "string")
      ekle(`theme.layouts[${i}]`, "needs layoutType and componentKey strings");
  });
  (Array.isArray(t.settings) ? t.settings : []).forEach((a, i) => {
    if (!nesneMi(a) || typeof a.key !== "string") ekle(`theme.settings[${i}].key`, "must be a string");
  });
  if (m.assets !== undefined) {
    if (!nesneMi(m.assets) || !Array.isArray(m.assets.files)) ekle("assets.files", "must be an array");
    else
      m.assets.files.forEach((f, i) => {
        if (!nesneMi(f)) return ekle(`assets.files[${i}]`, "must be an object");
        for (const alan of ["path", "kind", "sha256"]) if (typeof f[alan] !== "string") ekle(`assets.files[${i}].${alan}`, "must be a string");
        if (!nesneMi(f.license)) ekle(`assets.files[${i}].license`, "every file declares its licence { kind, holder, url }");
      });
  }
  return s;
}

/** @param {unknown} deger */
export function canonicalJson(deger) {
  if (Array.isArray(deger)) return `[${deger.map(canonicalJson).join(",")}]`;
  if (nesneMi(deger))
    return `{${Object.keys(deger)
      .filter((k) => deger[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(deger[k])}`)
      .join(",")}}`;
  return JSON.stringify(deger);
}

// `milofly theme …` — kompozisyon temasının yerel döngüsü. Tema geliştiricinin GELİŞTİRME MAĞAZASINDA yaşar (Web Yönetimi ile düzenlenir);
// CLI onu manifest olarak klasöre çeker, denetletir, sürüm olarak geri gönderip aynı mağazaya kurar. Gerçek mağazaya dokunamaz: her uç
// geliştiricinin kendi geliştirme mağazasını ister. Kurallar sunucudadır (sürüm yazıcısı ve kurulumla aynı doğrulayıcı).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assetFilePath, canonicalJson, checkManifestShape, PROJECT_LAYOUT, readThemeProject, writeThemeProject } from "@milofly/theme-sdk";
import { istemci } from "./oturum.mjs";
import { kalin, kirmizi, sari, sec, sor, soluk, uyar, yaz, yesil } from "./arayuz.mjs";

const AYAR = "milofly.theme.json";
const DURUM = join(".milofly", "state.json");
const ILK_SURUM = "0.1.0";

function proje(secenekler) {
  const kok = resolve(secenekler.path ?? ".");
  const dosya = join(kok, AYAR);
  if (!existsSync(dosya)) throw new Error(`${AYAR} not found in ${kok}. Run "milofly theme init" first (or pass --path).`);
  return { kok, ayar: JSON.parse(readFileSync(dosya, "utf8")) };
}

/** milofly.theme.json'a yazar; öteki alanlar korunur. */
function ayarYaz(kok, ayar) {
  writeFileSync(join(kok, AYAR), JSON.stringify(ayar, null, 2) + "\n");
}

function durumOku(kok) {
  const d = join(kok, DURUM);
  return existsSync(d) ? JSON.parse(readFileSync(d, "utf8")) : {};
}

function durumYaz(kok, durum) {
  mkdirSync(join(kok, ".milofly"), { recursive: true });
  writeFileSync(join(kok, DURUM), JSON.stringify(durum, null, 2) + "\n");
}

/**
 * Yayıncı anahtarı (`PUT /api/dev/publisher`; kural sahibi API'deki DevYayinciKimligi): bir kez seçilir, sonra değişmez; tema paketi
 * anahtarının `{yayıncı}/` kesimi ve uygulama anahtarının `app.{yayıncı}.` kesimidir. Seçilmişse onu döndürür; seçilmemişse
 * `istenen` ya da (etkileşimli terminalde) sorulup onaylanan değer yazılır.
 */
async function yayinciAnahtari(c, istenen) {
  const d = await c.cagir("/api/dev/publisher");
  if (d.publisherKey) return d.publisherKey;
  if (istenen === undefined && !process.stdin.isTTY)
    throw new Error('You have no publisher key yet. Choose it once: "milofly theme publisher <key>" (it cannot be changed later).');
  if (d.appSegments?.length) yaz(soluk(`Your apps already use: ${d.appSegments.join(", ")} — the publisher key must be one of them.`));
  const anahtar = (istenen ?? (await sor(`Publisher key ${soluk("(3–40: a-z, 0-9, -; cannot be changed later)")}`, { varsayilan: d.suggested ?? undefined })))
    .trim().toLowerCase();
  if (!anahtar) throw new Error('Publisher key is required. Run "milofly theme publisher <key>".');
  if (istenen === undefined && (await sor(`Use ${kalin(anahtar)} for good? (yes/no)`, { varsayilan: "no" })).toLowerCase() !== "yes")
    throw new Error("Publisher key was not saved.");
  const r = await c.cagir("/api/dev/publisher", { method: "PUT", govde: { publisherKey: anahtar } });
  yaz(`${yesil("✔")} Publisher key: ${kalin(r.publisherKey)}`);
  return r.publisherKey;
}

/** `theme publisher [key]` — yayıncı anahtarını gösterir; seçilmemişse seçer (portaldakiyle aynı uç). */
export async function publisher(secenekler, [istenen]) {
  const c = await istemci(secenekler);
  const d = await c.cagir("/api/dev/publisher");
  if (d.publisherKey) {
    if (istenen && istenen.trim().toLowerCase() !== d.publisherKey)
      throw new Error(`Your publisher key is already ${d.publisherKey}; it cannot be changed.`);
    return yaz(`Publisher key: ${kalin(d.publisherKey)}`);
  }
  await yayinciAnahtari(c, istenen);
}

/** `theme init [dir]` */
export async function init(secenekler, [hedef]) {
  const c = await istemci(secenekler);
  const yayinci = await yayinciAnahtari(c, undefined);

  const { stores } = await c.cagir("/api/dev/stores");
  if (stores.length === 0) throw new Error("You have no development store. Create one in the developer portal › Test stores.");
  const magaza = secenekler.store
    ? stores.find((s) => String(s.storeId) === String(secenekler.store)) ?? hataAt(`Development store ${secenekler.store} not found.`)
    : await sec("Development store", stores, (s) => `${s.storeName} ${soluk(`(${s.storeCode}, #${s.storeId})`)}`);

  const { themes } = await c.cagir(`/api/dev/theme-packages/source-themes?storeId=${magaza.storeId}`);
  const tema = secenekler.theme
    ? themes.find((t) => String(t.id) === String(secenekler.theme)) ?? hataAt(`Theme ${secenekler.theme} not found in ${magaza.storeCode}.`)
    : await sec("Theme to start from", themes, (t) => `${t.name} ${soluk(`(#${t.id}, ${t.languageCode}${t.status === "A" ? ", live" : ""})`)}`);

  const oneri = String(tema.name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "theme";
  const ad = secenekler.name ?? (await sor(`Package name ${soluk(`(key: ${yayinci}/<name>)`)}`, { varsayilan: oneri }));
  const kok = resolve(hedef ?? ad);
  if (existsSync(join(kok, AYAR))) throw new Error(`${join(kok, AYAR)} already exists.`);
  mkdirSync(kok, { recursive: true });
  writeFileSync(join(kok, AYAR), JSON.stringify({ storeId: magaza.storeId, storeCode: magaza.storeCode, sourceThemeId: tema.id, name: ad }, null, 2) + "\n");
  writeFileSync(join(kok, ".gitignore"), ".milofly/\ndist/\n");
  writeFileSync(join(kok, "README.md"),
    `# ${yayinci}/${ad}\n\nMilofly composition theme. Commands (run in this folder):\n\n` +
    "```\nmilofly theme pull     # bring the theme from your development store\nmilofly theme check    # validate with the Milofly rules\n" +
    "milofly theme dev      # push every change to your development store and open it\nmilofly theme push     # write the version in theme/package.json\n" +
    "milofly theme submit   # send that version to review\n```\n\nDocs: https://developer.milofly.com/docs/cli\n");
  await pull({ ...secenekler, path: kok }, [], c);
  yaz(`\n${yesil("✔")} ${kalin(`${yayinci}/${ad}`)} is ready in ${kok}`);
  yaz(`  Next: fill the catalog name and description in ${PROJECT_LAYOUT.package}, then ${kalin("milofly theme check")}.`);
}

function hataAt(m) {
  throw new Error(m);
}

/**
 * Parça eşleme: sayfada `sayfa anahtarı + bileşen anahtarı + aynı anahtarın kaçıncı geçişi`, yerleşimde `yerleşim türü + bileşen anahtarı
 * + kaçıncı geçiş` (API'nin DevTemaPaketleri.DilBloklariniTasi'siyle aynı kural). Araya başka bileşen eklemek eşlemeyi bozmaz.
 */
function parcalar(tema) {
  const harita = new Map();
  const ekle = (kapsam, liste) => {
    const sayac = new Map();
    for (const p of liste ?? []) {
      const n = (sayac.get(p.componentKey) ?? 0) + 1;
      sayac.set(p.componentKey, n);
      harita.set(`${kapsam}.${p.componentKey}#${n}`, p);
    }
  };
  for (const sayfa of tema?.pages ?? []) ekle(`page:${sayfa.systemPageKey}`, sayfa.components);
  for (const tur of new Set((tema?.layouts ?? []).map((l) => l.layoutType)))
    ekle(`layout:${tur}`, tema.layouts.filter((l) => l.layoutType === tur));
  return harita;
}

/**
 * Yerel dil metinleri çekilen temayı EZMEZ (27.11.2026, Faz 1). Mağaza dilinin metni mağazadan gelir (Web Yönetimi'nde düzenlenen odur);
 * öteki dillerde yereldeki blok kazanır (gönderilmemiş çeviri yereldedir), yerelde yoksa sunucunun paket sürümünden taşıdığı kalır.
 * Mağazada metni olmayan ya da artık bulunmayan parçanın yerel çevirisi uyarıyla düşer (dil simetrisi; değer uydurulmaz).
 */
function yerelDilleriKoru(sunucu, yerel, magazaDili) {
  const sunucuParcalar = parcalar(sunucu.theme);
  const dusen = [];
  for (const [anahtar, y] of parcalar(yerel.theme)) {
    const yerelBlok = y.defaultsByLang;
    if (!yerelBlok || typeof yerelBlok !== "object") continue;
    const digerDiller = Object.keys(yerelBlok).filter((d) => d.toLowerCase() !== String(magazaDili).toLowerCase());
    if (digerDiller.length === 0) continue;
    const s = sunucuParcalar.get(anahtar);
    if (!s || !s.defaultsByLang || typeof s.defaultsByLang !== "object") {
      dusen.push(`${anahtar} (${digerDiller.join(", ")})`);
      continue;
    }
    for (const d of digerDiller) s.defaultsByLang[d] = yerelBlok[d];
  }
  return dusen;
}

/**
 * `theme pull [--theme <id>]` — geliştirme mağazasındaki temayı klasöre yazar. İzlenen tema milofly.theme.json'daki `sourceThemeId`'dir;
 * `theme push` onu kurduğu temaya çevirir, `--theme` başka bir temaya çevirir. Yerel paket bilgisi (sürüm, kart metni, diller, varsayılan
 * dil) ve mağaza dili dışındaki yerel çeviriler korunur (`yerelDilleriKoru`).
 */
export async function pull(secenekler, _, c0) {
  const { kok, ayar } = proje(secenekler);
  const c = c0 ?? (await istemci(secenekler));
  if (secenekler.theme && String(secenekler.theme) !== String(ayar.sourceThemeId)) {
    if (!/^\d+$/.test(String(secenekler.theme))) throw new Error(`--theme must be a theme number (got "${secenekler.theme}").`);
    ayar.sourceThemeId = Number(secenekler.theme);
    ayarYaz(kok, ayar);
    yaz(soluk(`Now following theme #${ayar.sourceThemeId} (${AYAR}).`));
  }
  const r = await c.cagir(`/api/dev/theme-packages/source-themes/${ayar.sourceThemeId}/manifest?storeId=${ayar.storeId}` +
    `&name=${encodeURIComponent(ayar.name)}`);
  const manifest = r.manifest;
  const paketDosyasi = join(kok, PROJECT_LAYOUT.package);
  let dusen = [];
  if (existsSync(paketDosyasi)) {
    // Yerel proje bozuksa üzerine yazılmaz: önce düzeltilir (yerel çeviriler kaybolmasın).
    const yerel = await readThemeProject(kok);
    manifest.version = yerel.version || ILK_SURUM;
    if (yerel.catalogTranslations && Object.keys(yerel.catalogTranslations).length > 0) manifest.catalogTranslations = yerel.catalogTranslations;
    const diller = [...(yerel.supportedLanguageCodes ?? [])];
    for (const d of manifest.supportedLanguageCodes ?? []) if (!diller.some((x) => x.toLowerCase() === d.toLowerCase())) diller.push(d);
    if (diller.length > 0) manifest.supportedLanguageCodes = diller;
    if (yerel.defaultLanguageCode) manifest.defaultLanguageCode = yerel.defaultLanguageCode;
    dusen = yerelDilleriKoru(manifest, yerel, r.storeLanguageCode);
  } else {
    manifest.version = ILK_SURUM;
  }
  const yazilan = await writeThemeProject(kok, manifest);
  yaz(`${yesil("✔")} Pulled ${ayar.storeCode ?? `store #${ayar.storeId}`} › theme #${ayar.sourceThemeId}: ${manifest.theme.pages.length} pages, ` +
    `${manifest.theme.layouts.length} layouts, ${manifest.theme.settings.length} settings (${yazilan.length} files).`);
  yaz(soluk(`  Text in ${r.storeLanguageCode} comes from the store` +
    (r.sourceRelease ? `; ${r.releaseLanguageCodes?.length ? r.releaseLanguageCodes.join(", ") : "no other language"} from release ${r.sourceRelease}` : "") +
    `; languages: ${manifest.supportedLanguageCodes.join(", ")}.`));
  if (r.unmatchedComponents?.length)
    uyar(`Added in the store, no other language yet (only ${r.storeLanguageCode}): ${r.unmatchedComponents.join(", ")}`);
  if (dusen.length) uyar(`Local translations dropped (the part was removed in the store or has no text there): ${dusen.join("; ")}`);
  if (r.skippedPages?.length) uyar(`Not part of a theme package (content pages stay in the store): ${r.skippedPages.join(", ")}`);
}

function sorunlariYaz(baslik, liste, ton) {
  if (!liste?.length) return;
  yaz(`\n${ton(kalin(baslik))} ${soluk(`(${liste.length})`)}`);
  for (const s of liste) yaz(`  ${ton("•")} ${s.path || "(package)"} ${soluk(s.code)}\n    ${s.detail}`);
}

/**
 * Paketin kendi ikonlarını ve yazı tiplerini (theme/assets.json + theme/assets/) Milofly'a yükler: önce hangilerinin eksik olduğu sorulur,
 * yalnız eksikler gönderilir (dosya içerik özetiyle tanınır; aynı dosya ikinci kez yüklenmez). Sunucu SVG'yi temizler, PNG/WOFF2 imzasını
 * ve boyutu denetler, dosyayı pakete ait platform klasörüne yazar. check, push ve dev bu adımdan sonra manifesti gönderir.
 */
async function varliklariYukle(c, kok, manifest) {
  const dosyalar = manifest.assets?.files ?? [];
  if (dosyalar.length === 0) return;
  const { missing } = await c.cagir("/api/dev/theme-packages/assets/missing", {
    method: "POST",
    govde: { packageKey: manifest.packageKey, sha256s: dosyalar.map((d) => d.sha256) },
  });
  const eksik = new Set(missing);
  for (const d of dosyalar.filter((x, i, l) => eksik.has(x.sha256) && l.findIndex((y) => y.sha256 === x.sha256) === i)) {
    const form = new FormData();
    form.append("packageKey", manifest.packageKey);
    form.append("kind", d.kind);
    if (d.kind === "font") {
      form.append("weight", String(d.weight ?? ""));
      form.append("style", String(d.style ?? ""));
    }
    form.append("file", new Blob([readFileSync(assetFilePath(kok, d.path))]), d.path.split("/").pop());
    await c.cagir("/api/dev/theme-packages/assets", { method: "POST", govde: form });
    yaz(`${yesil("✔")} ${soluk("uploaded")} ${d.path}`);
  }
}

/** Henüz yüklenmemiş varlık dosyalarının özetleri (salt okuma: `assets/missing` yalnız sorar). */
async function eksikVarliklar(c, manifest) {
  const dosyalar = manifest.assets?.files ?? [];
  if (dosyalar.length === 0) return new Set();
  const { missing } = await c.cagir("/api/dev/theme-packages/assets/missing", {
    method: "POST",
    govde: { packageKey: manifest.packageKey, sha256s: dosyalar.map((d) => d.sha256) },
  });
  return new Set(missing);
}

const YUKLENMEMIS_VARLIK = "theme_package.asset_not_uploaded";

/**
 * `theme check` — yerel biçim + sunucu denetimi (sürüm, kurulum, yayım kapıları). SALT OKUMA (27.11.2026, Faz 1): hiçbir dosya yüklemez,
 * sürüm yazmaz. Yerelde duran ama henüz yüklenmemiş varlık dosyası engel sayılmaz, "push/dev yükler" diye ayrı listelenir (dosyanın
 * temizleme, imza ve boyut denetimi yüklemede yapılır). Çıkış kodu 1: sürüm yazılamaz ya da kurulamaz.
 */
export async function check(secenekler) {
  const { kok } = proje(secenekler);
  const manifest = await readThemeProject(kok);
  const c = await istemci(secenekler);
  const eksik = await eksikVarliklar(c, manifest);
  const r = await c.cagir("/api/dev/theme-packages/validate", { method: "POST", govde: manifest });
  const dosyalar = manifest.assets?.files ?? [];
  const bekleyen = [];
  const surum = (r.release ?? []).filter((s) => {
    if (s.code !== YUKLENMEMIS_VARLIK) return true;
    const i = Number(/^assets\.files\[(\d+)\]/.exec(s.path ?? "")?.[1]);
    const d = Number.isInteger(i) ? dosyalar[i] : undefined;
    if (!d || !eksik.has(d.sha256)) return true;
    bekleyen.push({ path: d.path, code: s.code, detail: "Uploaded by milofly theme push / theme dev." });
    return false;
  });
  const gecerli = surum.length === 0 && (r.install ?? []).length === 0;
  if (secenekler.json) {
    yaz(JSON.stringify({ valid: gecerli, release: surum, install: r.install, publish: r.publish, pendingUploads: bekleyen.map((b) => b.path) }, null, 2));
  } else {
    sorunlariYaz("Blocks the release", surum, kirmizi);
    sorunlariYaz("Release can be written but cannot be installed", r.install, kirmizi);
    sorunlariYaz("Blocks publishing to all stores (review)", r.publish, sari);
    sorunlariYaz("Not uploaded yet (push uploads them)", bekleyen, soluk);
    yaz(gecerli
      ? `\n${yesil("✔")} ${manifest.packageKey}@${manifest.version}: valid${r.publish.length ? " for your development store (fix the publishing items before review)" : ""}.`
      : `\n${kirmizi("✖")} ${manifest.packageKey}@${manifest.version}: not valid.`);
  }
  if (!gecerli) process.exitCode = 1;
  return { ...r, valid: gecerli, release: surum, pendingUploads: bekleyen };
}

async function gonder(c, ayar, kok, manifest, { activate, replaceThemeId }) {
  await varliklariYukle(c, kok, manifest);
  return c.cagir("/api/dev/theme-packages/push", {
    method: "POST",
    govde: { storeId: ayar.storeId, sourceThemeId: ayar.sourceThemeId, manifest, activate, replaceThemeId: replaceThemeId ?? null },
  });
}

function dogrulamaHatasi(hata) {
  const liste = hata.govde?.data?.errors;
  if (!Array.isArray(liste)) return false;
  sorunlariYaz("Rejected by Milofly", liste, kirmizi);
  return true;
}

/**
 * `theme push [--activate]` — theme/package.json'daki sürümü yazar (taslak) ve geliştirme mağazasına kurar. Sonra `theme pull` bu temayı
 * izler: milofly.theme.json'daki `sourceThemeId` kurulan temaya çevrilir (27.11.2026, Faz 1).
 */
export async function push(secenekler) {
  const { kok, ayar } = proje(secenekler);
  const manifest = await readThemeProject(kok);
  if (/-dev\./.test(manifest.version)) throw new Error("Development versions are written by milofly theme dev. Use a release version in theme/package.json.");
  const c = await istemci(secenekler);
  try {
    const r = await gonder(c, ayar, kok, manifest, { activate: Boolean(secenekler.activate) });
    yaz(`${yesil("✔")} ${r.packageKey}@${r.release.version} ${soluk(`(release #${r.release.id}, ${r.release.status})`)} installed in your development store as theme #${r.themeId}${r.activated ? " and published there" : ""}.`);
    if (String(r.themeId) !== String(ayar.sourceThemeId)) {
      const onceki = ayar.sourceThemeId;
      ayarYaz(kok, { ...ayar, sourceThemeId: r.themeId });
      yaz(soluk(`  milofly theme pull now follows theme #${r.themeId} (was #${onceki}; change it with --theme <id>).`));
    }
    if (r.activated && r.storefrontUrl) yaz(`  Storefront: ${r.storefrontUrl}`);
    yaz(`  Store panel: ${r.panelUrl}`);
    yaz(`  Send it to review: ${kalin("milofly theme submit")}`);
  } catch (hata) {
    if (dogrulamaHatasi(hata)) process.exitCode = 1;
    else throw hata;
  }
}

function gelistirmeSurumu(taban) {
  const z = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${String(taban).split(/[-+]/)[0]}-dev.${z}`;
}

/** `theme dev` — her değişiklikte geliştirme sürümü yazar, geliştirme mağazasına kurup yayına alır, önceki geliştirme kurulumunu siler. */
export async function dev(secenekler) {
  const { kok, ayar } = proje(secenekler);
  const c = await istemci(secenekler);
  let durum = durumOku(kok);
  let calisiyor = false;
  let bekleyen = false;

  async function tur() {
    if (calisiyor) { bekleyen = true; return; }
    calisiyor = true;
    try {
      const manifest = await readThemeProject(kok);
      const sorunlar = checkManifestShape(manifest);
      if (sorunlar.length) { sorunlariYaz("Local shape", sorunlar, kirmizi); return; }
      manifest.version = gelistirmeSurumu(manifest.version);
      const r = await gonder(c, ayar, kok, manifest, { activate: true, replaceThemeId: durum.devThemeId });
      durum = { ...durum, devThemeId: r.themeId, lastDevVersion: r.release.version };
      durumYaz(kok, durum);
      yaz(`${soluk(new Date().toLocaleTimeString())} ${yesil("✔")} ${r.release.version} → theme #${r.themeId} is live in your development store` +
        `${r.storefrontUrl ? `: ${r.storefrontUrl}` : ""}`);
      // Sunucu aynı gönderimde eski geliştirme kurulumlarını ve sürümlerini süpürür (periyodik iş yok).
      const sw = r.sweep;
      if (sw && (sw.deletedThemeIds?.length || sw.deletedVersions?.length))
        yaz(soluk(`  cleaned up: ${sw.deletedThemeIds.length} old development themes, ${sw.deletedVersions.length} old development versions`));
      if (sw?.artifactDeleteFailures?.length)
        uyar(`Milofly could not delete ${sw.artifactDeleteFailures.length} stored development file(s); this is logged on Milofly's side.`);
      // Sürüm süpürmesi yapılamadıysa kurulum yine tamamdır; eski geliştirme sürümleri bir sonraki gönderimde yeniden denenir.
      if (sw?.error)
        uyar(`Old development versions were not cleaned up this time (${sw.error}). Your change is installed; Milofly retries on the next change.`);
    } catch (hata) {
      if (!dogrulamaHatasi(hata)) yaz(`${kirmizi("✖")} ${hata.message}`);
    } finally {
      calisiyor = false;
      if (bekleyen) { bekleyen = false; tetikle(); }
    }
  }

  let zamanlayici = null;
  const tetikle = () => {
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(tur, 700);
  };

  yaz(`${kalin("milofly theme dev")} — ${ayar.storeCode ?? `store #${ayar.storeId}`}. Watching ${join(kok, PROJECT_LAYOUT.root)} (Ctrl+C to stop).`);
  yaz(soluk("Each change becomes a draft development release, is installed in your development store and published there. Your real stores are never touched."));
  await tur();
  watch(join(kok, PROJECT_LAYOUT.root), { recursive: true }, (_, dosya) => {
    // JSON ve paketin kendi varlıkları (ikon, yazı tipi) değişince yeni geliştirme sürümü.
    if (dosya && !/\.(json|svg|png|woff2)$/i.test(String(dosya))) return;
    tetikle();
  });
  await new Promise(() => {});
}

/** `theme pack` — paketin tek dosyalık manifesti (inceleme, arşiv, el ile yükleme için); sunucuya bir şey göndermez. */
export async function pack(secenekler) {
  const { kok } = proje(secenekler);
  const manifest = await readThemeProject(kok);
  mkdirSync(join(kok, "dist"), { recursive: true });
  const dosya = join(kok, "dist", `${manifest.packageKey.replace("/", "__")}-${manifest.version}.json`);
  writeFileSync(dosya, JSON.stringify(manifest, null, 2) + "\n");
  const ozet = createHash("sha256").update(canonicalJson(manifest)).digest("hex");
  yaz(`${yesil("✔")} ${dosya}\n  ${soluk(`sha256(canonical JSON) ${ozet} — local reference; Milofly computes its own content digest on push`)}`);
}

async function surumBul(c, packageKey, version) {
  const { packages } = await c.cagir("/api/dev/theme-packages");
  const paket = packages.find((p) => p.packageKey === packageKey);
  const surum = paket?.releases.find((r) => r.version === version);
  if (!surum) throw new Error(`${packageKey}@${version} has not been pushed yet. Run "milofly theme push" first.`);
  return surum;
}

/** `theme submit [--version x]` — sürümü platform incelemesine gönderir (taslak → incelemede). */
export async function submit(secenekler) {
  const { kok } = proje(secenekler);
  const manifest = await readThemeProject(kok);
  const surumNo = secenekler.version ?? manifest.version;
  if (/-dev\./.test(surumNo)) throw new Error("Development versions are not sent to review. Push a release version first.");
  const c = await istemci(secenekler);
  const surum = await surumBul(c, manifest.packageKey, surumNo);
  const r = await c.cagir(`/api/dev/theme-packages/releases/${surum.id}/submit`, { method: "POST" });
  yaz(`${yesil("✔")} ${manifest.packageKey}@${r.release.version} sent to review (${r.release.status}).`);
}

/** `theme list` */
export async function list(secenekler) {
  const c = await istemci(secenekler);
  const { packages } = await c.cagir("/api/dev/theme-packages");
  if (packages.length === 0) return yaz("No theme packages yet.");
  for (const p of packages) {
    yaz(kalin(p.packageKey));
    for (const r of p.releases.filter((r) => secenekler.all || !/-dev\./.test(r.version)))
      yaz(`  ${r.version.padEnd(28)} ${r.status.padEnd(10)} ${soluk(`#${r.id}`)}${r.reviewNote ? `\n    ${sari("review:")} ${r.reviewNote}` : ""}`);
    const gizli = p.releases.filter((r) => /-dev\./.test(r.version)).length;
    if (!secenekler.all && gizli) yaz(soluk(`  … ${gizli} development versions (--all to show)`));
  }
}

export const komutlar = { init, publisher, pull, check, push, dev, pack, submit, list };

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLanguageCode(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const SETTING_ROLE_VALUE_TYPES = new Set([
  "length", "color", "string", "number", "boolean", "enum", "font", "url",
]);
const SETTING_ROLE_OWNERS = new Set([
  "theme_scope", "section_wrapper", "component_root", "component_internal",
  "item", "control", "runtime",
]);
const SETTING_ROLE_OUTPUT_KINDS = new Set(["css_variable", "runtime_value"]);
const SETTING_ROLE_TRANSFORMS = new Set([
  "identity", "fluid_single_length", "breakpoint_capped_single_length", "color", "font", "shadow_preset",
]);
const SETTING_ROLE_DIRECTION_POLICIES = new Set(["logical", "physical", "none"]);
const SETTING_ROLE_EMPTY_POLICIES = new Set(["inherit", "clear", "invalid"]);
const SETTING_ROLE_ZERO_POLICIES = new Set(["apply", "invalid"]);
/**
 * DEĞER TAŞIMAYAN ALAN TİPLERİ — TEK KAYNAK.
 *
 * Bu tipteki bir alan panelde çizilir ama ayara HİÇBİR DEĞER yazmaz. Bu yüzden iki soru
 * onlar için anlamsızdır ve iki kapı aynı listeyi tüketir:
 *   · "hangi semantik sınıfa ait" (setting_role / content_role / dışlama) → burada muaf;
 *   · "vitrin bu anahtarı okuyor mu" → alan matrisinde `deger_tasimayan_alan` sayılır
 *     (bkz. `component-field-matrix.mjs`). Liste ikinci bir dosyaya KOPYALANMAZ, ithal edilir.
 *
 * `campaign_reward_tiers` (10.09.2026): ödül çubuğunu oluşturan GERÇEK kampanya listesini
 * salt okunur gösterir. Hedef tutar, ödül ve bitiş kampanya motorunun malıdır; mağazacı
 * görmediği çubuğu biçimlendiremeyeceği için alan panelde durur, ama kaydedilen değeri yoktur.
 */
export const DEGER_TASIMAYAN_TIPLER = new Set([
  "heading", "divider", "separator", "campaign_reward_tiers",
]);

/** Alan bir değer saklıyor mu — kararın TEK sahibi. */
export function alanDegerTasimazMi(field) {
  return DEGER_TASIMAYAN_TIPLER.has(field?.type);
}
const STANDARD_ROLE_FIELD_DUPLICATES = ["unit", "responsive_policy", "output"];
const CONTENT_ROLE_CARDINALITIES = new Set(["scalar", "collection"]);
const SETTING_ROLE_EXCLUSION_CODES = new Set([
  "compatibility_transport",
  "component_local",
  "content_owned",
  "example_specific",
  "runtime_control",
]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateEnum(issues, sourceName, fieldName, value, allowed) {
  if (!allowed.has(value)) {
    issues.push(`${sourceName}: ${fieldName} '${String(value ?? "<boş>")}' geçersiz`);
  }
}

/**
 * Platform standard setting-role kataloğunun yapısal kapısıdır. Varsayılan değer taşımaz;
 * rol yalnız anlamı, sahibi ve üretilecek çıktıyı tanımlar.
 */
export function validateSettingRoleCatalog(catalog, sourceName = "setting-role-catalog") {
  const issues = [];
  if (!isRecord(catalog)) return [`${sourceName}: katalog nesnesi eksik`];
  if (!Number.isSafeInteger(catalog.version) || catalog.version < 1) {
    issues.push(`${sourceName}: version pozitif tam sayı olmalı`);
  }
  // `body_owners` = merkezî doldurmanın (applyComponentSettingRoles) DOKUNDUĞU sahipler.
  // Hem shared runtime hem API'nin tema tohumu süzgeci bunu okur; kod tarafında ikinci
  // kopya tutulmaz. Süzgeç bir anahtarı yalnız bu sahiplerde düşürebildiği için küme
  // sözleşmenin parçasıdır, uygulama detayı değildir.
  if (!Array.isArray(catalog.body_owners) || catalog.body_owners.length === 0) {
    issues.push(`${sourceName}: body_owners dizisi eksik`);
  } else {
    for (const owner of catalog.body_owners) {
      if (!SETTING_ROLE_OWNERS.has(owner)) {
        issues.push(`${sourceName}: body_owners '${String(owner)}' geçerli bir sahip değil`);
      }
    }
  }

  if (!Array.isArray(catalog.roles)) return [...issues, `${sourceName}: roles dizisi eksik`];

  const seen = new Set();
  for (const [index, definition] of catalog.roles.entries()) {
    const rowName = `${sourceName}.roles[${index}]`;
    if (!isRecord(definition)) {
      issues.push(`${rowName}: rol tanımı nesne olmalı`);
      continue;
    }

    const role = nonEmptyString(definition.role) ? definition.role.trim() : "";
    if (!role) issues.push(`${rowName}: role boş`);
    else if (seen.has(role)) issues.push(`${sourceName}: '${role}' birden fazla tanımlı`);
    else seen.add(role);

    validateEnum(issues, rowName, "value_type", definition.value_type, SETTING_ROLE_VALUE_TYPES);
    validateEnum(issues, rowName, "owner", definition.owner, SETTING_ROLE_OWNERS);
    validateEnum(
      issues,
      rowName,
      "direction_policy",
      definition.direction_policy,
      SETTING_ROLE_DIRECTION_POLICIES,
    );
    validateEnum(issues, rowName, "empty_policy", definition.empty_policy, SETTING_ROLE_EMPTY_POLICIES);
    validateEnum(issues, rowName, "zero_policy", definition.zero_policy, SETTING_ROLE_ZERO_POLICIES);

    // Sayı rolünün aralığı (yazma kapısı, panel kaydırıcısı ve vitrin aynı alanı okur; `themeRoleRange`, `TemaDegerKapisi`).
    if (definition.range !== undefined) {
      const range = definition.range;
      if (definition.value_type !== "number") issues.push(`${rowName}: range yalnız number rolünde tanımlanır`);
      if (!isRecord(range) || typeof range.min !== "number" || typeof range.max !== "number" || range.min > range.max) {
        issues.push(`${rowName}: range { min ≤ max } sayılarından oluşmalı`);
      } else if (range.integer !== undefined && typeof range.integer !== "boolean") {
        issues.push(`${rowName}: range.integer true ya da false olmalı`);
      }
    }

    if (definition.value_type === "length" && definition.unit !== "px") {
      issues.push(`${rowName}: length rolünün unit değeri 'px' olmalı`);
    }

    if (!isRecord(definition.output)) {
      issues.push(`${rowName}: output nesnesi eksik`);
    } else {
      validateEnum(issues, rowName, "output.kind", definition.output.kind, SETTING_ROLE_OUTPUT_KINDS);
      validateEnum(
        issues,
        rowName,
        "output.transform",
        definition.output.transform,
        SETTING_ROLE_TRANSFORMS,
      );
      if (!nonEmptyString(definition.output.name)) issues.push(`${rowName}: output.name boş`);
    }

    if (!Number.isSafeInteger(definition.catalog_version) || definition.catalog_version < 1) {
      issues.push(`${rowName}: catalog_version pozitif tam sayı olmalı`);
    }
  }

  return issues;
}

/** İçerik hedefleri ve kaynak çıktıları aynı makine-okunur katalogda tutulur. */
export function validateContentRoleCatalog(catalog, sourceName = "content-role-catalog") {
  const issues = [];
  if (!isRecord(catalog)) return [`${sourceName}: katalog nesnesi eksik`];
  if (!Number.isSafeInteger(catalog.version) || catalog.version < 1) {
    issues.push(`${sourceName}: version pozitif tam sayı olmalı`);
  }
  for (const [collectionName, kind] of [["content_roles", "content"], ["output_roles", "output"]]) {
    const definitions = catalog[collectionName];
    if (!Array.isArray(definitions)) {
      issues.push(`${sourceName}: ${collectionName} dizisi eksik`);
      continue;
    }
    const seen = new Set();
    definitions.forEach((definition, index) => {
      const row = `${sourceName}.${collectionName}[${index}]`;
      if (!isRecord(definition)) {
        issues.push(`${row}: rol tanımı nesne olmalı`);
        return;
      }
      for (const property of ["role", "semantic"]) {
        if (!nonEmptyString(definition[property])) issues.push(`${row}: ${property} boş`);
      }
      const role = nonEmptyString(definition.role) ? definition.role.trim() : "";
      if (role && seen.has(role)) issues.push(`${sourceName}: ${kind} role '${role}' birden fazla tanımlı`);
      seen.add(role);
      validateEnum(issues, row, "cardinality", definition.cardinality, CONTENT_ROLE_CARDINALITIES);
      if (kind === "content") {
        if (!Array.isArray(definition.schema_types) || definition.schema_types.length === 0 || definition.schema_types.some(value => !nonEmptyString(value))) {
          issues.push(`${row}: schema_types dolu metin dizisi olmalı`);
        }
        if (!Array.isArray(definition.value_types) || definition.value_types.length === 0 || definition.value_types.some(value => !nonEmptyString(value))) {
          issues.push(`${row}: value_types dolu metin dizisi olmalı`);
        }
      } else if (!nonEmptyString(definition.value_type)) {
        issues.push(`${row}: value_type boş`);
      }
    });
  }
  return issues;
}

export function createContentRoleIndex(catalog) {
  const issues = validateContentRoleCatalog(catalog);
  if (issues.length > 0) throw new Error(issues.join("\n"));
  return {
    content: new Map(catalog.content_roles.map(definition => [definition.role, definition])),
    output: new Map(catalog.output_roles.map(definition => [definition.role, definition])),
  };
}

/** Alan adından anlam tahmin etmez; rol semantiği, türü ve kardinalitesi birlikte eşleşir. */
export function validateContentSourceBindingContract(target, source, index, sourceName = "content-binding") {
  const issues = [];
  const contentRole = index?.content?.get(target?.content_role);
  const outputRole = index?.output?.get(source?.output_role);
  if (!contentRole) issues.push(`${sourceName}: content_role '${String(target?.content_role ?? "<boş>")}' tanımsız`);
  if (!outputRole) issues.push(`${sourceName}: output_role '${String(source?.output_role ?? "<boş>")}' tanımsız`);
  if (!contentRole || !outputRole) return issues;

  if (!contentRole.schema_types.includes(target?.schema_type)) {
    issues.push(`${sourceName}: schema_type '${String(target?.schema_type ?? "<boş>")}' content_role ile uyumsuz`);
  }
  if (outputRole.value_type !== source?.value_type || outputRole.cardinality !== source?.cardinality) {
    issues.push(`${sourceName}: output_role metadata katalogla uyuşmuyor`);
  }
  if (!contentRole.value_types.includes(outputRole.value_type)) {
    issues.push(`${sourceName}: value_type '${outputRole.value_type}' hedef tarafından kabul edilmiyor`);
  }
  if (contentRole.cardinality !== outputRole.cardinality) {
    issues.push(`${sourceName}: kardinalite uyumsuz`);
  }
  if (contentRole.semantic !== outputRole.semantic) {
    issues.push(`${sourceName}: semantik uyumsuz (${outputRole.semantic} → ${contentRole.semantic})`);
  }
  return issues;
}

function fieldIsSemanticRoleExempt(field) {
  if (alanDegerTasimazMi(field)) return true;
  return field?.type === "hidden" && field?.runtime_reserved === true;
}

/**
 * Kaydedilen görünür alanı tam bir semantik sınıfa bağlar. `key` yalnız depolama kimliğidir;
 * alanın anlamı anahtar metninden çıkarılmaz.
 */
export function validateComponentFieldSemanticContracts(
  fields,
  settingRoleCatalog,
  contentRoles = new Set(),
  sourceName = "component-schema",
) {
  const issues = [];
  const definitions = Array.isArray(settingRoleCatalog?.roles)
    ? new Set(settingRoleCatalog.roles.map(item => item?.role).filter(nonEmptyString))
    : new Set();
  const validateContentRoleNames = contentRoles !== null;
  const knownContentRoles = contentRoles instanceof Set ? contentRoles : new Set(contentRoles ?? []);

  if (!Array.isArray(fields)) return [`${sourceName}: fields dizisi eksik`];
  for (const [index, field] of fields.entries()) {
    const key = nonEmptyString(field?.key) ? field.key.trim() : `<index:${index}>`;
    const rowName = `${sourceName}.${key}`;
    if (!isRecord(field) || fieldIsSemanticRoleExempt(field)) continue;

    const hasSettingRole = nonEmptyString(field.setting_role);
    const hasContentRole = nonEmptyString(field.content_role);
    const hasSettingRoleExclusion = Object.hasOwn(field, "setting_role_exclusion");
    if (Number(hasSettingRole) + Number(hasContentRole) + Number(hasSettingRoleExclusion) !== 1) {
      issues.push(
        `${rowName}: setting_role, content_role veya setting_role_exclusion sınıflarından tam olarak biri gerekli`,
      );
      continue;
    }

    if (hasSettingRole) {
      const role = field.setting_role.trim();
      if (!definitions.has(role)) issues.push(`${rowName}: setting_role '${role}' tanımsız`);
      for (const duplicate of STANDARD_ROLE_FIELD_DUPLICATES) {
        if (Object.hasOwn(field, duplicate)) {
          issues.push(`${rowName}: '${duplicate}' platform standard rol kataloğunu kopyalayamaz`);
        }
      }
    }

    if (hasContentRole) {
      const role = field.content_role.trim();
      if (validateContentRoleNames && !knownContentRoles.has(role)) {
        issues.push(`${rowName}: content_role '${role}' tanımsız`);
      }
    }

    if (hasSettingRoleExclusion) {
      const exclusion = field.setting_role_exclusion;
      if (!isRecord(exclusion)) {
        issues.push(`${rowName}: setting_role_exclusion nesne olmalı`);
        continue;
      }
      const keys = Object.keys(exclusion).sort();
      if (keys.join(",") !== "code,reason") {
        issues.push(`${rowName}: setting_role_exclusion yalnız code ve reason taşımalı`);
      }
      validateEnum(
        issues,
        `${rowName}.setting_role_exclusion`,
        "code",
        exclusion.code,
        SETTING_ROLE_EXCLUSION_CODES,
      );
      if (!nonEmptyString(exclusion.reason) || exclusion.reason.trim().length < 20) {
        issues.push(`${rowName}: setting_role_exclusion.reason en az 20 karakterlik açık gerekçe olmalı`);
      }
    }
  }

  return issues;
}

function semanticDebtIdentity(item) {
  return `${item.componentKey}|${item.scope}|${item.key}`;
}

/**
 * Mevcut v1 schema'lardaki semantik rol eksiğini ölçer. Üst seviye kapı bu envanterin
 * doğrudan sıfır olmasını ister; burada kabul/baseline kararı verilmez. Bir schema açıkça
 * v2'ye geçtiğinde veya bir alan role taşınmaya başlandığında strict XOR ihlali ayrıca fatal olur.
 */
export function inspectComponentSemanticRoleInventory(
  schema,
  settingRoleCatalog,
  contentRoles = null,
  sourceName,
) {
  const componentKey = nonEmptyString(sourceName)
    ? sourceName.trim()
    : nonEmptyString(schema?.componentKey)
      ? schema.componentKey.trim()
      : "<unknown>";
  const fatalIssues = [];
  const legacyDebt = [];
  const hasVersionMarker = isRecord(schema) && Object.hasOwn(schema, "schemaContractVersion");
  const rawVersion = schema?.schemaContractVersion;
  const validVersion = Number.isSafeInteger(rawVersion) && rawVersion >= 1;

  if (hasVersionMarker && !validVersion) {
    fatalIssues.push(`${componentKey}: schemaContractVersion pozitif tam sayı olmalı`);
  }
  const enforceEntireSchema = validVersion && rawVersion >= 2;

  for (const scope of ["settingsSchema", "itemsSchema"]) {
    const fields = Array.isArray(schema?.[scope]) ? schema[scope] : [];
    for (const [index, field] of fields.entries()) {
      if (!isRecord(field) || fieldIsSemanticRoleExempt(field)) continue;
      const key = nonEmptyString(field.key) ? field.key.trim() : `<index:${index}>`;
      const roleMigrated = Object.hasOwn(field, "setting_role")
        || Object.hasOwn(field, "content_role")
        || Object.hasOwn(field, "setting_role_exclusion");

      if (!enforceEntireSchema && !roleMigrated) {
        legacyDebt.push({ componentKey, scope, key });
        continue;
      }

      fatalIssues.push(...validateComponentFieldSemanticContracts(
        [field],
        settingRoleCatalog,
        contentRoles,
        `${componentKey}.${scope}`,
      ));
    }
  }

  return {
    fatalIssues: [...new Set(fatalIssues)].sort(),
    legacyDebt: [...new Map(
      legacyDebt.map(item => [semanticDebtIdentity(item), item]),
    ).values()].sort((left, right) => semanticDebtIdentity(left).localeCompare(semanticDebtIdentity(right))),
  };
}

export function collectSchemaLabelReferences(schema) {
  const references = new Set();

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    for (const [key, nested] of Object.entries(value)) {
      // `dynamic_option_label_key`: veri kaynağından gelen seçeneğin etiket kalıbı (panel `SelectField`); öteki etiketler gibi her dilde zorunlu.
      if ((key === "label_key" || key === "info_key" || key === "group" || key === "dynamic_option_label_key") && typeof nested === "string" && nested.trim()) {
        references.add(nested.trim());
      }
      visit(nested);
    }
  }

  visit(schema?.settingsSchema);
  visit(schema?.itemsSchema);
  return [...references].sort();
}

export function validateActiveLanguageCoverage(schema, activeLanguageCodes, sourceName = "schema.json") {
  const issues = [];
  const active = [...new Set(activeLanguageCodes.map(normalizeLanguageCode).filter(Boolean))].sort();
  const defaultsByLang = isRecord(schema?.defaultsByLang) ? schema.defaultsByLang : {};
  const schemaLabels = isRecord(schema?.schemaLabels) ? schema.schemaLabels : {};
  const translations = Array.isArray(schema?.translations) ? schema.translations : [];
  const translationsByCode = new Map();
  const labelReferences = collectSchemaLabelReferences(schema);

  for (const translation of translations) {
    const code = normalizeLanguageCode(translation?.languageCode);
    if (!code) continue;
    if (translationsByCode.has(code)) {
      issues.push(`${sourceName}: translations.${code} birden fazla tanımlı`);
      continue;
    }
    translationsByCode.set(code, translation);
  }

  if (active.length === 0) {
    issues.push(`${sourceName}: Central aktif dil kataloğu boş`);
    return issues;
  }

  const defaultLanguageCode = normalizeLanguageCode(schema?.defaultLanguageCode);
  if (!active.includes(defaultLanguageCode)) {
    issues.push(`${sourceName}: defaultLanguageCode '${defaultLanguageCode || "<boş>"}' aktif dil kataloğunda yok`);
  }

  for (const code of active) {
    if (!isRecord(defaultsByLang[code])) {
      issues.push(`${sourceName}: defaultsByLang.${code} eksik`);
    }

    const translation = translationsByCode.get(code);
    if (!translation || typeof translation.name !== "string" || !translation.name.trim()) {
      issues.push(`${sourceName}: translations.${code}.name eksik`);
    }

    const labels = schemaLabels[code];
    if (!isRecord(labels)) {
      issues.push(`${sourceName}: schemaLabels.${code} eksik`);
      continue;
    }
    for (const reference of labelReferences) {
      if (typeof labels[reference] !== "string" || !labels[reference].trim()) {
        issues.push(`${sourceName}: schemaLabels.${code}.${reference} eksik`);
      }
    }
  }

  return issues;
}

/* ───────────────────────────── ŞEMA PARÇALARI ─────────────────────────────
 * Birden çok bileşenin AYNI anlamla taşıdığı ayar kümesi (bülten formunun ek alanları, açılır pencere
 * yuvasının tetik ve hedefleme alanları) tek dosyada tanımlanır: `src/sema-parcalari/<ad>.json`.
 * Bileşen şeması parçayı üst düzeyde beyan eder:
 *
 *   "schemaFragments": [{ "fragment": "newsletter_form", "enabledBy": "show_newsletter",
 *                         "group": "comp.ft02.group.newsletter", "defaults": { … } }]
 *
 * Üretici (generate-component-runtime.mjs) beyan eden şemaya parçanın alanlarını, varsayılanlarını ve
 * etiketlerini yazar. Yazdığı her alan `"fragment": "<ad>"` damgası taşır; parçayı açıp kapatan anahtar
 * (`enabledBy`) `"fragment_switch": "<ad>"` damgası alır. Damga makine-okunur beyandır: sunucu "bu
 * bileşen bülten formu gömüyor mu, o an gösteriyor mu" sorusunu bileşen adına bakmadan buradan okur.
 *
 * Kuralın TEK sahibi bu fonksiyondur: üretici onunla yazar, şema eşitleme (sync-schema.mjs) onunla
 * "şema parçasıyla aynı mı" diye denetler. Parça dışında elle yazılmış damga ya da aynı anahtarı
 * taşıyan damgasız alan hatadır (aynı ayarın iki sahibi olmaz).
 */
const FRAGMENT_SWITCH_VALUES = [true, "true", 1, "1"];
const FRAGMENT_DECLARATION_KEYS = new Set(["fragment", "enabledBy", "group", "defaults", "prefix", "parts", "fields", "responsive", "roles", "fixedLayer"]);
const FRAGMENT_INCLUDE_KEYS = new Set(["include", "prefix", "parts", "fields", "responsive", "group"]);
const FRAGMENT_PREFIX_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_$/;

/*
 * ÖRNEKLİ (ÖNEKLİ) PARÇA — 13.11.2026, Web Yönetimi ortak stil F1.
 *
 * Bir parça bir bileşende birden çok kez, her seferinde başka bir ÖNEKLE kullanılabilir: aynı stil sözlüğü bölüm sarmalına
 * (`wrap_`) ve bir iç bloğa (`conditional_offer_`) uygulanır, alan adları ve değer kümeleri tek dosyada (`stil.json`) durur.
 * Örnek kimliği ad + önektir; öneksiz kullanım eskisi gibi tek örnektir. Örnek başına üç karar:
 *   · `prefix`     — alan anahtarlarının ve parçanın kendi alanlarına başvuran `visible_when.field` değerlerinin öneki.
 *   · `parts`      — alan ve seçenek `part` etiketiyle süzülür (etiketsiz alan/seçenek her zaman gelir). Bloğun çizemediği
 *                    kabiliyet (ör. video arka planı) o blokta panelde de görünmez; "varmış gibi görünüp çalışmayan" alan doğmaz.
 *   · `fields`     — yalnız bu alanlar (parçanın kendi anahtarlarıyla, öneksiz). Bloğun alt öğesi (seçili kart, rozet) sözlüğün birkaç
 *                    alanını kullanır; aynı adlar, aynı aralıklar, aynı etiketler.
 *   · `responsive` — parçanın `responsive: true` beyan ettiği alanlar cihaz başına değer kabul eder mi. Kapalıysa beyan düşer
 *                    (cihaz başına değeri çizemeyen blok, örn. satır içi stil basan blok, cihaz düğmesi göstermez).
 *   · `group`      — yalnız parça içi `include` satırında: gömülen alanların sabit grubu (alt öğenin başlığı, ör. "Seçili Kart"). Bileşen
 *                    beyanının `group`'u bu alanları ezmez; başlık gömen parçanın kendi etiketidir.
 * Etiketler parçanın kendi önekiyle (`fragment.<ad>.`) kalır; aynı etiketi her örnek paylaşır.
 *
 * ÖRNEK BAŞINA ROL (`roles`) — 14.11.2026, ortak stil göçü D1. Parçanın alanları rolsüzdür (`setting_role_exclusion: component_local`):
 * iç blokta boş değer bloğun kendi değerini bırakır. Bölüm sarmalında ise bazı alanlar bileşenin TEMA MİRASLI kök ayarının yeni evidir
 * (kök zemin rengi `bg_color` → `wrap_bg_color`). Yalnız bileşen şemasının beyanı, örnek başına hangi alanın hangi rolü taşıdığını söyler:
 *   { "fragment": "style", "prefix": "wrap_", …, "roles": { "bg_color": "color.component.background" } }
 * Üretici o alanın dışlamasını kaldırıp `setting_role` yazar; rol kataloğu denetimi, "bir rol tek alana bağlanır" kuralı ve rol → alan
 * haritası (`component-setting-roles.generated.ts`) bileşenin öteki alanlarıyla AYNI yoldan çalışır. Parça içi `include` satırı rol taşımaz.
 *
 * SABİT KATMAN (`fixedLayer`) — 14.11.2026, ortak stil. Bileşen kendi sabit katmanını (portal'sız `position: fixed` çubuk, çekmece,
 * pencere) bu örneğin öğesinin İÇİNDE çiziyorsa beyan eder: { "fragment": "style", "prefix": "wrap_", …, "fixedLayer": true }.
 * Neden: sarmala `transform` veren efekt (Nabız, Sallanma, Yükselme, Yakınlaşma) sürdüğü sürece sarmal sabit konumlu torunların kapsayan
 * bloğu ve yığın bağlamı olur; çubuk ekranın değil sarmalın altına yapışır, sonraki bölümün altında kalır (ölçüm c7b8f9c92). Dönüşümsüz
 * yapılamaz. Parçanın o seçenekleri `closed_with_fixed_layer: { label_key }` beyan eder (`stil.json`). Beyanlı örnekte seçenek şemadan
 * ÇIKAR ve alana `closed_options: [{ value, label_key }]` yazılır: panel nedeni alanın altında gösterir, yazma kapısı (API
 * `ComponentDataSchemaGuard`) kapalı değeri "closed" nedeniyle reddeder (kayıtta zaten duran değer yazıyı kilitlemez), Milo'nun ayar
 * görünümü aynı listeyi okur. Beyansız örnekte seçenek yerinde kalır, beyan alanı düşer. Bileşen adı listesi kodda yoktur.
 *
 * Örnek iki yerden doğar: bileşen şemasının `schemaFragments` beyanı ve başka bir parçanın `fields` dizisindeki
 * `{ "include": "<ad>", "prefix": "…", "parts": […] }` satırı (parça içi parça; dizinleme anında açılır, sırası korunur).
 */
export function fragmentInstanceFields(fragment, { prefix = "", parts = null, fields = null, responsive = false, fixedLayer = false } = {}) {
  const localKeys = new Set(fragment.fields.map(field => field.key));
  const allowed = (entry) => (parts === null || entry?.part === undefined || parts.includes(entry.part))
    && (fields === null || entry?.key === undefined || fields.includes(entry.key));
  const prefixCondition = (condition) => {
    if (!isRecord(condition) || typeof condition.field !== "string" || !localKeys.has(condition.field)) return condition;
    return { ...condition, field: `${prefix}${condition.field}` };
  };
  // Süzgeçle (`parts` / `fields`) örneğe GİRMEYEN parça alanına bakan koşul düşer: denetleyen alan bu örnekte yoktur, alan koşulsuz görünür.
  // Düşmezse koşul şemada olmayan alana bakar ve panel alanı gizli sayar (adet kademesinin dört renk alanı, 14.11.2026 karşıt denetim).
  const instanceKeys = new Set(fragment.fields.filter(allowed).map(field => field.key));
  const liveCondition = (condition) => !isRecord(condition) || typeof condition.field !== "string"
    || !localKeys.has(condition.field) || instanceKeys.has(condition.field);
  return fragment.fields.filter(allowed).map((field) => {
    const copy = structuredClone(field);
    delete copy.part;
    copy.key = `${prefix}${field.key}`;
    if (Array.isArray(copy.options)) {
      const closed = [];
      copy.options = copy.options.filter(allowed).flatMap((option) => {
        if (!isRecord(option)) return [option];
        const { part: _part, closed_with_fixed_layer: fixedLayerClosure, ...rest } = option;
        if (fixedLayer && isRecord(fixedLayerClosure)) {
          closed.push({ value: rest.value, label_key: fixedLayerClosure.label_key });
          return [];
        }
        return [rest];
      });
      if (closed.length > 0) copy.closed_options = closed;
    }
    if (Array.isArray(copy.visible_when)) {
      copy.visible_when = copy.visible_when.filter(liveCondition).map(prefixCondition);
      if (copy.visible_when.length === 0) delete copy.visible_when;
    } else if (isRecord(copy.visible_when)) {
      if (liveCondition(copy.visible_when)) copy.visible_when = prefixCondition(copy.visible_when);
      else delete copy.visible_when;
    }
    // Parça alanının eski adı (`legacy_key`, `legacy_fallbacks[].key`) parçanın YEREL adıdır (stil.json `margin_top` ← `margin_y`):
    // örneğin önekiyle yazılır, yoksa eski ad başka bir örneğin ya da bileşenin alanına bağlanırdı.
    if (typeof copy.legacy_key === "string" && copy.legacy_key.trim()) copy.legacy_key = `${prefix}${copy.legacy_key.trim()}`;
    if (Array.isArray(copy.legacy_fallbacks)) {
      copy.legacy_fallbacks = copy.legacy_fallbacks.map((fallback) => (
        isRecord(fallback) && typeof fallback.key === "string" ? { ...fallback, key: `${prefix}${fallback.key}` } : fallback
      ));
    }
    // `responsive`: örnek bütün cihazlı alanları (true) ya da yalnız adı verilen yerel alanları (dizi) cihaz başına açar.
    if (responsive !== true && !(Array.isArray(responsive) && responsive.includes(field.key))) delete copy.responsive;
    return copy;
  });
}

function fragmentInstanceOptions(entry, sourceName, issues) {
  const prefix = nonEmptyString(entry?.prefix) ? entry.prefix.trim() : "";
  if (entry?.prefix !== undefined && !FRAGMENT_PREFIX_PATTERN.test(prefix)) {
    issues.push(`${sourceName}: önek '${entry.prefix}' küçük harf, rakam ve alt çizgiyle yazılıp '_' ile bitmeli`);
  }
  let parts = null;
  if (entry?.parts !== undefined) {
    if (!Array.isArray(entry.parts) || entry.parts.length === 0 || !entry.parts.every(nonEmptyString)) {
      issues.push(`${sourceName}: parts dolu bir metin dizisi olmalı`);
    } else parts = entry.parts.map(part => part.trim());
  }
  if (entry?.responsive !== undefined && typeof entry.responsive !== "boolean") {
    issues.push(`${sourceName}: responsive true/false olmalı`);
  }
  let fields = null;
  if (entry?.fields !== undefined) {
    if (!Array.isArray(entry.fields) || entry.fields.length === 0 || !entry.fields.every(nonEmptyString)) {
      issues.push(`${sourceName}: fields dolu bir metin dizisi olmalı`);
    } else fields = entry.fields.map(field => field.trim());
  }
  if (entry?.fixedLayer !== undefined && entry.fixedLayer !== true) {
    issues.push(`${sourceName}: fixedLayer yalnız true olabilir (beyan yoksa alan yazılmaz)`);
  }
  return { prefix, parts, fields, responsive: entry?.responsive === true, fixedLayer: entry?.fixedLayer === true };
}

/** `fields` süzgecindeki her ad parçada var mı (yanlış yazılmış ad sessizce alan düşürmesin). */
function checkInstanceFields(fragment, options, sourceName, issues) {
  if (options.fields === null) return;
  const keys = new Set(fragment.fields.map(field => field.key));
  for (const key of options.fields) if (!keys.has(key)) issues.push(`${sourceName}: '${key}' alanı parçada yok`);
}

function fragmentKnownParts(fragment) {
  const parts = new Set();
  for (const field of fragment.fields) {
    if (nonEmptyString(field?.part)) parts.add(field.part);
    for (const option of Array.isArray(field?.options) ? field.options : []) if (nonEmptyString(option?.part)) parts.add(option.part);
  }
  return parts;
}

/** Parça içi `include` satırlarını açar (bir kez, iç içe parça içermeyen parçadan). Etiketler alıcı belgeye kopyalanır. */
function resolveFragmentIncludes(byName, issues) {
  for (const [name, document] of byName) {
    if (!document.fields.some(field => Object.hasOwn(field ?? {}, "include"))) continue;
    const fields = [];
    const labelPrefixes = new Set([`fragment.${name}.`]);
    for (const field of document.fields) {
      if (!Object.hasOwn(field ?? {}, "include")) { fields.push(field); continue; }
      const source = `sema-parcalari:${name} include '${field.include}'`;
      const unknownKeys = Object.keys(field).filter(key => !FRAGMENT_INCLUDE_KEYS.has(key));
      if (unknownKeys.length > 0) issues.push(`${source}: bilinmeyen alan: ${unknownKeys.join(", ")}`);
      const included = byName.get(field.include);
      if (!included) { issues.push(`${source}: parça yok`); continue; }
      if (included.fields.some(inner => Object.hasOwn(inner ?? {}, "include"))) {
        issues.push(`${source}: iç içe parça içeren parça başka parçaya gömülemez`);
        continue;
      }
      const options = fragmentInstanceOptions(field, source, issues);
      const known = fragmentKnownParts(included);
      for (const part of options.parts ?? []) if (!known.has(part)) issues.push(`${source}: '${part}' bölümü parçada yok`);
      checkInstanceFields(included, options, source, issues);
      if (field.group !== undefined && !nonEmptyString(field.group)) issues.push(`${source}: group dolu bir etiket anahtarı olmalı`);
      fields.push(...fragmentInstanceFields(included, options).map((copy) => (
        nonEmptyString(field.group) ? { ...copy, group: field.group.trim(), fixed_group: true } : copy
      )));
      labelPrefixes.add(`fragment.${field.include}.`);
      for (const [code, labels] of Object.entries(included.labels)) {
        document.labels[code] = { ...(isRecord(labels) ? labels : {}), ...(isRecord(document.labels[code]) ? document.labels[code] : {}) };
      }
    }
    document.fields = fields;
    document.labelPrefixes = [...labelPrefixes];
  }
}

/** Parça dosyalarını ada göre dizinler; dosyanın biçimini denetler. Girdi: [kaynakAdı, belge] çiftleri. */
export function indexSchemaFragments(fragmentDocuments) {
  const byName = new Map();
  const issues = [];
  const pending = [];
  for (const [sourceName, rawDocument] of fragmentDocuments) {
    const document = structuredClone(rawDocument);
    const name = nonEmptyString(document?.fragment) ? document.fragment.trim() : "";
    if (!name) {
      issues.push(`${sourceName}: fragment adı boş`);
      continue;
    }
    if (byName.has(name)) {
      issues.push(`${sourceName}: '${name}' parçası birden fazla dosyada tanımlı`);
      continue;
    }
    if (!Array.isArray(document.fields) || document.fields.length === 0) {
      issues.push(`${sourceName}: fields dizisi boş`);
      continue;
    }
    if (!isRecord(document.labels) || Object.keys(document.labels).length === 0) {
      issues.push(`${sourceName}: labels nesnesi eksik`);
      continue;
    }
    byName.set(name, document);
    pending.push([sourceName, name, document]);
  }
  resolveFragmentIncludes(byName, issues);
  for (const [sourceName, name, document] of pending) {
    const prefixes = Array.isArray(document.labelPrefixes) ? document.labelPrefixes : [`fragment.${name}.`];
    const references = new Set();
    if (nonEmptyString(document.group)) references.add(document.group.trim());
    const keys = new Set();
    for (const field of document.fields) {
      const key = nonEmptyString(field?.key) ? field.key.trim() : "";
      if (!key) issues.push(`${sourceName}: anahtarı boş alan`);
      else if (keys.has(key)) issues.push(`${sourceName}: '${key}' alanı iki kez tanımlı`);
      keys.add(key);
      if (!Object.hasOwn(field ?? {}, "default")) {
        issues.push(`${sourceName}.${key}: parça alanı varsayılan ilan etmeli`);
      }
      for (const reference of collectSchemaLabelReferences({ settingsSchema: [field] })) references.add(reference);
    }
    for (const reference of references) {
      if (!prefixes.some(prefix => reference.startsWith(prefix))) {
        issues.push(`${sourceName}: etiket anahtarı '${reference}' ${prefixes.map(p => `'${p}'`).join(" / ")} ile başlamalı`);
      }
      for (const [code, labels] of Object.entries(document.labels)) {
        if (typeof labels?.[reference] !== "string" || !labels[reference].trim()) {
          issues.push(`${sourceName}: labels.${code}.${reference} eksik`);
        }
      }
    }
  }
  return { byName, issues };
}

/**
 * Şemanın parça beyanlarına göre OLMASI GEREKEN hâlini üretir (girdiyi değiştirmez).
 * Dönen `schema` girdiyle aynı içerikteyse şema parçalarıyla eşittir.
 */
export function expandSchemaFragments(schema, fragmentsByName, sourceName = "schema.json") {
  const issues = [];
  const declarations = schema?.schemaFragments;
  const fields = Array.isArray(schema?.settingsSchema) ? schema.settingsSchema : [];

  if (declarations === undefined) {
    const stamped = fields.filter(field =>
      Object.hasOwn(field ?? {}, "fragment") || Object.hasOwn(field ?? {}, "fragment_switch"));
    if (stamped.length > 0) {
      issues.push(
        `${sourceName}: schemaFragments beyanı yok ama damgalı alan var: ${stamped.map(field => field.key).join(", ")}`,
      );
    }
    return { schema, issues };
  }
  if (!Array.isArray(declarations) || declarations.length === 0) {
    return { schema, issues: [`${sourceName}: schemaFragments dolu bir dizi olmalı`] };
  }

  // Örnek kimliği ad + önek (öneksiz beyan eskisi gibi tek örnektir). Damga: `fragment` (ad) + önekliyse `fragment_prefix`.
  const instanceId = (name, prefix) => `${name}|${prefix}`;
  const declared = new Map();
  for (const declaration of declarations) {
    const name = nonEmptyString(declaration?.fragment) ? declaration.fragment.trim() : "";
    const unknownKeys = Object.keys(declaration ?? {}).filter(key => !FRAGMENT_DECLARATION_KEYS.has(key));
    if (unknownKeys.length > 0) {
      issues.push(`${sourceName}: schemaFragments['${name}'] bilinmeyen alan taşıyor: ${unknownKeys.join(", ")}`);
    }
    if (!fragmentsByName.has(name)) {
      issues.push(`${sourceName}: '${name || "<boş>"}' adlı şema parçası yok`);
      continue;
    }
    const options = fragmentInstanceOptions(declaration, `${sourceName}: schemaFragments['${name}']`, issues);
    checkInstanceFields(fragmentsByName.get(name), options, `${sourceName}: schemaFragments['${name}']`, issues);
    const known = fragmentKnownParts(fragmentsByName.get(name));
    for (const part of options.parts ?? []) {
      if (!known.has(part)) issues.push(`${sourceName}: schemaFragments['${name}'] '${part}' bölümü parçada yok`);
    }
    if (declaration.roles !== undefined) {
      const instanceKeys = new Set(fragmentInstanceFields(fragmentsByName.get(name), options).map(field => field.key.slice(options.prefix.length)));
      if (!isRecord(declaration.roles) || Object.keys(declaration.roles).length === 0) {
        issues.push(`${sourceName}: schemaFragments['${name}'].roles dolu bir nesne olmalı (alan → setting_role)`);
      } else {
        for (const [key, role] of Object.entries(declaration.roles)) {
          if (!instanceKeys.has(key)) issues.push(`${sourceName}: schemaFragments['${name}'].roles '${key}' bu örnekte yok`);
          if (!nonEmptyString(role)) issues.push(`${sourceName}: schemaFragments['${name}'].roles.${key} dolu bir setting_role olmalı`);
        }
      }
    }
    if (options.fixedLayer && !fragmentInstanceFields(fragmentsByName.get(name), options).some(field => Array.isArray(field.closed_options))) {
      issues.push(`${sourceName}: schemaFragments['${name}'].fixedLayer bu örnekte hiçbir seçeneği kapatmıyor (parça ya da bölümleri sabit katmanla çakışan seçenek taşımıyor)`);
    }
    const id = instanceId(name, options.prefix);
    if (declared.has(id)) {
      issues.push(`${sourceName}: '${name}' parçası aynı önekle iki kez beyan edilmiş`);
      continue;
    }
    declared.set(id, { name, declaration, options });
  }
  if (issues.length > 0) return { schema, issues };

  const next = structuredClone(schema);
  // Damgalı alanlar parçanın malıdır: yerlerinden çıkarılır, parçadaki tanımla aynı yere yeniden yazılır.
  const positions = new Map();
  const kept = [];
  for (const field of next.settingsSchema ?? []) {
    const owner = field?.fragment;
    if (owner === undefined) {
      const { fragment_switch: _eskiDamga, ...rest } = field;
      kept.push(rest);
      continue;
    }
    const id = instanceId(owner, typeof field.fragment_prefix === "string" ? field.fragment_prefix : "");
    if (!declared.has(id)) {
      issues.push(`${sourceName}.${field.key}: '${owner}' damgası beyan edilmemiş bir parçaya ait`);
      continue;
    }
    if (!positions.has(id)) positions.set(id, kept.length);
  }

  const defaults = isRecord(next.defaultSettings) ? next.defaultSettings : {};
  const labels = isRecord(next.schemaLabels) ? next.schemaLabels : {};
  const result = [...kept];
  const yerlesecekler = [];
  // Etiketler: beyan edilen parçaların öneklerini taşıyan eski satırlar BİR KEZ düşer (aynı parçanın iki örneği birbirinin
  // satırını silmesin), sonra her örneğin başvurduğu satırlar yazılır.
  const labelPrefixes = new Set();
  for (const { name } of declared.values()) {
    const fragment = fragmentsByName.get(name);
    for (const prefix of Array.isArray(fragment.labelPrefixes) ? fragment.labelPrefixes : [`fragment.${name}.`]) labelPrefixes.add(prefix);
  }
  for (const code of Object.keys(labels)) {
    if (!isRecord(labels[code])) continue;
    labels[code] = Object.fromEntries(Object.entries(labels[code])
      .filter(([key]) => ![...labelPrefixes].some(prefix => key.startsWith(prefix))));
  }
  for (const [id, { name, declaration, options }] of declared) {
    const fragment = fragmentsByName.get(name);
    const enabledBy = nonEmptyString(declaration.enabledBy) ? declaration.enabledBy.trim() : "";
    const overrides = isRecord(declaration.defaults) ? declaration.defaults : {};
    const roles = isRecord(declaration.roles) ? declaration.roles : {};
    const fragmentKeys = new Set(fragment.fields.map(field => field.key));
    for (const key of Object.keys(overrides)) {
      if (!fragmentKeys.has(key)) {
        issues.push(`${sourceName}: schemaFragments['${name}'].defaults '${key}' parçada yok`);
      }
    }
    if (enabledBy) {
      const owner = result.find(field => field?.key === enabledBy);
      if (!owner) issues.push(`${sourceName}: schemaFragments['${name}'].enabledBy '${enabledBy}' alanı şemada yok`);
      else owner.fragment_switch = name;
    }

    const expanded = fragmentInstanceFields(fragment, options).map((copy) => {
      const localKey = copy.key.slice(options.prefix.length);
      if (kept.some(existing => existing?.key === copy.key)) {
        issues.push(`${sourceName}.${copy.key}: parça alanıyla aynı anahtarı taşıyan damgasız alan var`);
      }
      // Parça içi `include` satırının sabit grubu (alt öğe başlığı) bileşen beyanının grubuyla ezilmez.
      if (copy.fixed_group === true) delete copy.fixed_group;
      else copy.group = nonEmptyString(declaration.group)
        ? declaration.group.trim()
        : (nonEmptyString(copy.group) ? copy.group : fragment.group);
      if (Object.hasOwn(overrides, localKey)) copy.default = overrides[localKey];
      // Örnek başına rol: alan bu bileşende tema miraslı bir rolün evidir; parçanın "yerel ayar" dışlaması düşer (alan tek sınıf taşır).
      if (Object.hasOwn(roles, localKey)) {
        delete copy.setting_role_exclusion;
        copy.setting_role = String(roles[localKey]).trim();
      }
      if (enabledBy) {
        // Alanın kendi koşulu tek nesne de olabilir (`stil.json` → `bg_position` vb.); listeye çevrilip korunur. Yalnız diziyi
        // koruyan önceki kod tek nesne koşulları düşürüyordu: düz renk seçiliyken görsel odağı, kaplama, özel gölge ayarları panelde
        // görünüyordu (14.11.2026 canlı denetimi, Kampanya Gösterimi'nin Stil sekmesi). Aynı kural item-blocks.mjs'te.
        const own = Array.isArray(copy.visible_when) ? copy.visible_when : (isRecord(copy.visible_when) ? [copy.visible_when] : []);
        copy.visible_when = [{ field: enabledBy, value: FRAGMENT_SWITCH_VALUES }, ...own];
      }
      copy.fragment = name;
      if (options.prefix) copy.fragment_prefix = options.prefix;
      defaults[copy.key] = copy.default;
      return copy;
    });
    yerlesecekler.push({ at: positions.has(id) ? positions.get(id) : null, expanded });

    const references = collectSchemaLabelReferences({ settingsSchema: expanded })
      .filter(reference => [...labelPrefixes].some(prefix => reference.startsWith(prefix)));
    for (const [code, fragmentLabels] of Object.entries(fragment.labels)) {
      const current = isRecord(labels[code]) ? labels[code] : {};
      for (const reference of references) current[reference] = fragmentLabels[reference];
      labels[code] = current;
    }
  }

  // Yeri belli olanlar sondan başa yerleşir (öndeki ekleme arkadaki konumu kaydırmasın); yeni parça sona eklenir.
  // Aynı yerdeki iki parça (art arda duran parçalar) beyan sırasıyla kalsın diye eşitlikte sonra beyan edilen önce yerleşir.
  // Şemada henüz alanı olmayan (yeni beyan edilen) parça, kendisinden SONRA beyan edilmiş ve yeri belli ilk parçanın yerine oturur:
  // ikinci koşumda da tam orada bulunacağı için üretici tek koşumda kararlıdır (eskiden yeni parça sona ekleniyor, sonraki koşum onu
  // beyan sırasına çekiyordu: ilk koşumun çıktısı `--check`'ten geçmiyordu). Arkasında yeri belli parça yoksa sona eklenir.
  for (let sira = yerlesecekler.length - 1, sonrakiYer = null; sira >= 0; sira--) {
    if (yerlesecekler[sira].at === null) yerlesecekler[sira].at = sonrakiYer;
    else sonrakiYer = yerlesecekler[sira].at;
  }
  const yerli = yerlesecekler
    .map((item, sira) => ({ ...item, sira }))
    .filter(item => item.at !== null)
    .sort((left, right) => (right.at - left.at) || (right.sira - left.sira));
  for (const { at, expanded } of yerli) {
    result.splice(at, 0, ...expanded);
  }
  for (const { expanded } of yerlesecekler.filter(item => item.at === null)) result.push(...expanded);

  next.settingsSchema = result;
  next.defaultSettings = defaults;
  next.schemaLabels = labels;
  return { schema: next, issues };
}

/**
 * İki şema anlamca aynı mı: nesne anahtarlarının SIRASI anlam taşımaz (ör. `schemaLabels`'ı üretici parçalardan sonra blokları da
 * açarak alfabetik dizer; yalnız parçaları açan denetim aynı içeriği başka sırayla üretir ve eskiden düz metin karşılaştırması bunu
 * "eşit değil" sayıp bileşeni hiç eşitletmiyordu). Dizi sırası anlamlıdır (alan sırası, seçenek sırası), korunur.
 */
function kanonikJson(deger) {
  if (Array.isArray(deger)) return `[${deger.map(kanonikJson).join(",")}]`;
  if (deger && typeof deger === "object") {
    return `{${Object.keys(deger).sort().map((anahtar) => `${JSON.stringify(anahtar)}:${kanonikJson(deger[anahtar])}`).join(",")}}`;
  }
  return JSON.stringify(deger);
}
export function semaIcerikEsitMi(sol, sag) {
  return kanonikJson(sol) === kanonikJson(sag);
}

/** Şema parçalarıyla eşit mi (tema geliştirici aracı: @milofly/theme-sdk/component-schema). */
export function validateSchemaFragments(schema, fragmentsByName, sourceName = "schema.json") {
  const { schema: expected, issues } = expandSchemaFragments(schema, fragmentsByName, sourceName);
  if (issues.length > 0) return issues;
  if (!semaIcerikEsitMi(expected, schema)) {
    return [`${sourceName}: şema parçalarıyla eşit değil; schema.json parçalardan yeniden üretilmeli`];
  }
  return [];
}

/* ───────────────────────────── DİNAMİK ALAN BEYANLARI ─────────────────────────────
 * Sözleşme: `src/dinamik-alan-sozlesmesi.json` (jeton deseni, yerel ad alanı, metin alan türleri).
 *
 * Beyanların HEPSİ alan düzeyindedir (ayar şeması ya da öğe şeması alanı). Gerekçe: API'ye yalnız
 * `settingsSchema` / `itemsSchema` dizileri taşınır ve tek sunucu okuyucusu alan başınadır
 * (`SchemaDefaultsFilter.FieldSpec`); şemanın üst düzeyine yazılan beyan hiçbir okuyucuya ulaşmaz.
 * Beyan yalnız metin türündeki alana yazılır (sözleşmedeki `metinAlanTurleri`).
 *
 *   "dynamic": false                      → alan dinamik alana kapalı
 *   "dynamic": { "html": true }           → değeri HTML olarak çizilen text/textarea (`htmlBeyaniTurleri`)
 *   "dynamic": { "live": true }           → ziyaret anı alanı kabul eder (ortak <DinamikMetin>) — D-F2
 *   "dynamic": { "local": ["min","max"] } → kabul ettiği {{bu.x}} adları — D-F2
 *   "hide_with": ["delivery_icon"]        → metin boşalınca birlikte gizlenen, AYNI şemadaki komşu alanlar
 *   "hide_when_empty": true               → BU alan jeton yüzünden boşalırsa kapsayan gizlenir
 *                                           (ayar şemasında bileşen, öğe şemasında öğe)
 *
 * `hide_when_empty` yalnız `true` olabilir: beyanı boşalan alanın kendisi taşır. Alan adı listesi biçimi yoktur;
 * aynı kuralı iki ayrı yoldan yazdırır ve iki alanın çelişen liste taşımasına yol açardı.
 *
 * D-F2 beyanları ve jetonları D-F1'de REDDEDİLİR, çünkü karşılıkları henüz yok:
 *   · `dynamic.local` ve `{{bu.x}}`: AÇILDI (16.11.2026) — istemci çözücüsü `dinamikAlanYerelCoz` (`dinamik-alan.ts`); depo
 *     denetimi `yerelBeyanAcik: true` ile çağırır. Dış geliştirici denetimi (theme-sdk) seçeneği kendisi verir.
 *   · `dynamic.live`: ortak `<DinamikMetin>` ve ziyaret ucu gelmeden menü canlı alan sunamaz.
 *   · zengin metin alanının varsayılanında jeton: zengin metin çipi ve `span[data-alan]` sarması D-F2'dir.
 * D-F2'de çağıran `{ yerelBeyanAcik, canliBeyanAcik, zenginMetinAcik }` verir; anahtarlar burada, tek yerde açılır.
 */
const DYNAMIC_DECLARATION_KEYS = new Set(["local", "live", "html", "context"]);
const DYNAMIC_SCHEMA_SCOPES = ["settingsSchema", "itemsSchema"];
const DYNAMIC_FIELD_DECLARATIONS = ["dynamic", "hide_with", "hide_when_empty"];
const DYNAMIC_DEFAULT_SOURCES = ["defaultSettings", "defaultsByLang", "runtimeDefaultsByLang"];
const DYNAMIC_LANG_DEFAULT_SOURCES = ["defaultsByLang", "runtimeDefaultsByLang"];

function collectStrings(value, path, visit) {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((nested, index) => collectStrings(nested, `${path}[${index}]`, visit));
    return;
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) collectStrings(nested, `${path}.${key}`, visit);
  }
}

const dinamikAlanAdListesiMi = value => Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);

/** Bir alanın varsayılan değerlerinin bulunduğu yerler (alanın kendi `default`'u, şema ve dil varsayılanları). */
function fieldDefaultSources(schema, scope, field) {
  const sources = [];
  const key = field.key;
  if (Object.hasOwn(field, "default")) sources.push([field.default, `${scope}.${key}.default`]);
  if (scope === "settingsSchema" && isRecord(schema.defaultSettings) && Object.hasOwn(schema.defaultSettings, key)) {
    sources.push([schema.defaultSettings[key], `defaultSettings.${key}`]);
  }
  for (const source of DYNAMIC_LANG_DEFAULT_SOURCES) {
    if (!isRecord(schema[source])) continue;
    for (const [lang, block] of Object.entries(schema[source])) {
      if (!isRecord(block)) continue;
      if (scope === "settingsSchema") {
        // İki biçim: `{ settings: {...}, items: [...] }` (defaultsByLang) ve düz `{ anahtar: değer }` (runtimeDefaultsByLang).
        const settings = isRecord(block.settings) ? block.settings : block;
        if (Object.hasOwn(settings, key)) sources.push([settings[key], `${source}.${lang}.${key}`]);
      } else if (Array.isArray(block.items)) {
        block.items.forEach((item, index) => {
          if (isRecord(item) && Object.hasOwn(item, key)) sources.push([item[key], `${source}.${lang}.items[${index}].${key}`]);
        });
      }
    }
  }
  return sources;
}

/**
 * Şemadaki dinamik alan beyanlarının ve varsayılan metinlerdeki jetonların derleme denetimi.
 * `contract`: `dinamik-alan-sozlesmesi.json` içeriği (çağıran okur; bu fonksiyon dosya okumaz).
 * Jetonun KODU burada denetlenmez: katalog veridir (`platform.dynamic_fields`), kararı sunucudaki yazma kapısı verir.
 */
export function validateDynamicFieldDeclarations(
  schema,
  contract,
  sourceName = "schema.json",
  { yerelBeyanAcik = false, canliBeyanAcik = false, zenginMetinAcik = false } = {},
) {
  const issues = [];
  if (!isRecord(contract) || !nonEmptyString(contract.jeton) || !nonEmptyString(contract.hamJeton)
    || !nonEmptyString(contract.kod) || !contract.jeton.includes(`(${contract.kod})`)
    || !nonEmptyString(contract.yerelAdAlani) || !dinamikAlanAdListesiMi(contract.metinAlanTurleri)
    || !dinamikAlanAdListesiMi(contract.htmlBeyaniTurleri) || !dinamikAlanAdListesiMi(contract.zenginMetinAlanTurleri)) {
    return [`${sourceName}: dinamik alan sözleşmesi okunamadı (jeton, hamJeton, kod, yerelAdAlani, metinAlanTurleri, htmlBeyaniTurleri, zenginMetinAlanTurleri gerekli; jeton deseni kod desenini taşımalı)`];
  }
  if (!isRecord(schema)) return [`${sourceName}: şema nesnesi eksik`];

  const tamJeton = new RegExp(`^(?:${contract.jeton})$`);
  const tamKod = new RegExp(`^(?:${contract.kod})$`);
  const yerelOnek = `${contract.yerelAdAlani}.`;
  const yerelAdGecerliMi = ad => nonEmptyString(ad) && tamKod.test(`${yerelOnek}${ad}`);
  const metinTurleri = new Set(contract.metinAlanTurleri);
  const htmlBeyaniTurleri = new Set(contract.htmlBeyaniTurleri);
  const zenginMetinTurleri = new Set(contract.zenginMetinAlanTurleri);
  const hamJeton = new RegExp(contract.hamJeton, "g");

  for (const declaration of DYNAMIC_FIELD_DECLARATIONS) {
    if (Object.hasOwn(schema, declaration)) {
      issues.push(`${sourceName}: '${declaration}' şemanın üst düzeyinde beyan edilemez; alanın kendi tanımına yazılmalı`);
    }
  }

  for (const scope of DYNAMIC_SCHEMA_SCOPES) {
    const fields = Array.isArray(schema[scope]) ? schema[scope] : [];
    const keys = new Set(fields.map(field => field?.key).filter(nonEmptyString));

    for (const [index, field] of fields.entries()) {
      if (!isRecord(field)) continue;
      const key = nonEmptyString(field.key) ? field.key : null;
      const rowName = `${sourceName}.${scope}.${key ?? `<index:${index}>`}`;
      const metinAlani = metinTurleri.has(field.type);
      const declares = DYNAMIC_FIELD_DECLARATIONS.filter(property => Object.hasOwn(field, property));
      if (declares.length > 0 && !metinAlani) {
        issues.push(`${rowName}: ${declares.join(", ")} yalnız metin türündeki alanda beyan edilir (${contract.metinAlanTurleri.join(", ")}); alanın türü '${String(field.type)}'`);
        continue;
      }

      if (Object.hasOwn(field, "dynamic")) {
        const declaration = field.dynamic;
        if (declaration === false) {
          // Açık kapalılık beyanı; varsayılanında jeton taşıyamaz (aşağıda).
        } else if (!isRecord(declaration)) {
          issues.push(`${rowName}: dynamic yalnız false ya da beyan nesnesi olabilir (açık olmak varsayılandır, true yazılmaz)`);
        } else {
          const declared = Object.keys(declaration);
          if (declared.length === 0) issues.push(`${rowName}: dynamic boş nesne olamaz`);
          const unknown = declared.filter(property => !DYNAMIC_DECLARATION_KEYS.has(property));
          if (unknown.length > 0) issues.push(`${rowName}: dynamic bilinmeyen anahtar taşıyor: ${unknown.join(", ")}`);
          for (const flag of ["live", "html"]) {
            if (Object.hasOwn(declaration, flag) && typeof declaration[flag] !== "boolean") {
              issues.push(`${rowName}: dynamic.${flag} true ya da false olmalı`);
            }
          }
          if (Object.hasOwn(declaration, "context")) {
            // Bağlamlı bileşen alanı (18.11.2026): değer sözleşmenin `bilesenBaglamYuzeyleri`'nde olmalı; alan bileşen metni (düz/çok satırlı)
            // ya da zengin metin türünde olmalı. Yerel değer beyanıyla birlikte yazılmaz (iki ayrı çip yolu olurdu).
            const baglamlar = isRecord(contract.bilesenBaglamYuzeyleri) ? Object.keys(contract.bilesenBaglamYuzeyleri) : [];
            const bilesenTurleri = new Set([...(contract.bilesenMetniYuzeyi?.alanTurleri ?? []), ...contract.zenginMetinAlanTurleri]);
            if (!baglamlar.includes(declaration.context)) {
              issues.push(`${rowName}: dynamic.context '${String(declaration.context)}' sözleşmenin bileşen bağlamlarında yok (${baglamlar.join(", ")})`);
            }
            if (!bilesenTurleri.has(field.type)) {
              issues.push(`${rowName}: dynamic.context yalnız ${[...bilesenTurleri].join(", ")} türünde beyan edilir; alanın türü '${field.type}'`);
            }
            if (Object.hasOwn(declaration, "local")) issues.push(`${rowName}: dynamic.context ile dynamic.local birlikte beyan edilemez`);
          }
          if (Object.hasOwn(declaration, "html") && !htmlBeyaniTurleri.has(field.type)) {
            issues.push(`${rowName}: dynamic.html yalnız ${contract.htmlBeyaniTurleri.join(", ")} türünde beyan edilir; alanın türü '${field.type}'`);
          }
          if (Object.hasOwn(declaration, "live") && !canliBeyanAcik) {
            issues.push(`${rowName}: dynamic.live D-F2 beyanıdır; ortak <DinamikMetin> ve ziyaret ucu gelmeden şemaya yazılamaz`);
          }
          if (Object.hasOwn(declaration, "local")) {
            if (!yerelBeyanAcik) {
              issues.push(`${rowName}: dynamic.local D-F2 beyanıdır; istemci çözücüsü gelmeden şemaya yazılamaz`);
            } else if (!Array.isArray(declaration.local) || declaration.local.length === 0) {
              issues.push(`${rowName}: dynamic.local dolu bir ad dizisi olmalı`);
            } else {
              const seen = new Set();
              for (const name of declaration.local) {
                if (!yerelAdGecerliMi(name)) issues.push(`${rowName}: dynamic.local '${String(name)}' jeton desenine uymuyor`);
                else if (seen.has(name)) issues.push(`${rowName}: dynamic.local '${name}' iki kez beyan edilmiş`);
                seen.add(name);
              }
            }
          }
        }
      }

      if (Object.hasOwn(field, "hide_with")) {
        const value = field.hide_with;
        if (!Array.isArray(value) || value.length === 0) {
          issues.push(`${rowName}: hide_with dolu bir alan adı dizisi olmalı`);
        } else {
          const seen = new Set();
          for (const target of value) {
            if (!nonEmptyString(target)) {
              issues.push(`${rowName}: hide_with boş ya da metin olmayan değer taşıyor`);
              continue;
            }
            if (seen.has(target)) issues.push(`${rowName}: hide_with '${target}' alanını iki kez sayıyor`);
            seen.add(target);
            if (target === key) issues.push(`${rowName}: hide_with alanın kendisini gösteremez`);
            else if (!keys.has(target)) {
              issues.push(`${rowName}: hide_with '${target}' alanını gösteriyor ama ${scope} içinde böyle alan yok`);
            }
          }
        }
      }
      if (Object.hasOwn(field, "hide_when_empty") && field.hide_when_empty !== true) {
        issues.push(`${rowName}: hide_when_empty yalnız true olabilir; beyanı boşalan alanın kendisi taşır (alan adı listesi yazılmaz)`);
      }

      // Alanın kendi varsayılanlarındaki geçerli jetonlar: jeton yalnız dinamik alana açık metin alanında durabilir.
      if (key === null) continue;
      for (const [value, path] of fieldDefaultSources(schema, scope, field)) {
        collectStrings(value, path, (text, textPath) => {
          if (!text.includes("{{")) return;
          const jetonlar = [...text.matchAll(hamJeton)].map(match => match[0]).filter(ham => tamJeton.test(ham));
          if (jetonlar.length === 0) return;
          const ornek = jetonlar[0];
          if (!metinAlani) {
            issues.push(`${sourceName}: ${textPath} jeton taşıyor ('${ornek}') ama alan metin türünde değil ('${String(field.type)}'); jeton çözülmez`);
          } else if (field.dynamic === false) {
            issues.push(`${sourceName}: ${textPath} jeton taşıyor ('${ornek}') ama alan dynamic: false beyanlı`);
          } else if (!zenginMetinAcik && zenginMetinTurleri.has(field.type)) {
            issues.push(`${sourceName}: ${textPath} zengin metin alanında jeton taşıyor ('${ornek}'); zengin metin çipi D-F2'de açılır`);
          }
        });
      }
    }
  }

  // Bütün varsayılan metinler: desene uymayan çift süslü parantez ve (D-F1'de) yerel ad alanı reddedilir.
  const inspectText = (text, path) => {
    if (!text.includes("{{")) return;
    for (const match of text.matchAll(hamJeton)) {
      const parsed = tamJeton.exec(match[0]);
      if (!parsed) issues.push(`${sourceName}: ${path} jeton desenine uymayan '${match[0]}' taşıyor`);
      else if (!yerelBeyanAcik && parsed[1].startsWith(yerelOnek)) {
        issues.push(`${sourceName}: ${path} yerel değer jetonu '${match[0]}' taşıyor; '${yerelOnek}' ad alanı D-F2'de açılır`);
      }
    }
  };
  for (const source of DYNAMIC_DEFAULT_SOURCES) collectStrings(schema[source], source, inspectText);
  for (const scope of DYNAMIC_SCHEMA_SCOPES) {
    const fields = Array.isArray(schema[scope]) ? schema[scope] : [];
    for (const field of fields) {
      if (isRecord(field) && Object.hasOwn(field, "default")) {
        collectStrings(field.default, `${scope}.${String(field.key)}.default`, inspectText);
      }
    }
  }

  return issues;
}

/** Bütün bileşen şemalarında dinamik alan beyanlarını denetler (doğrudan koşumun gövdesi; modül yüklenirken çalışmaz). */
async function runDynamicFieldDeclarationCheck() {
  const { readFile, readdir } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
  const contract = JSON.parse(await readFile(`${srcDir}dinamik-alan-sozlesmesi.json`, "utf8"));
  const entries = (await readdir(`${srcDir}components`, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const issues = [];
  let count = 0;
  for (const entry of entries) {
    let raw;
    try {
      raw = await readFile(`${srcDir}components/${entry.name}/schema.json`, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    count += 1;
    // D-F2 yerel kısmı açıldı (16.11.2026): istemci çözücüsü `dinamikAlanYerelCoz` (dinamik-alan.ts) ve panelin çipli alanı
    // (`YerelDinamikMetinAlani`) var. Canlı alan ve zengin metin jetonu hâlâ D-F2'nin açılmamış kısmıdır.
    issues.push(...validateDynamicFieldDeclarations(JSON.parse(raw), contract, entry.name, { yerelBeyanAcik: true }));
  }
  if (issues.length > 0) {
    console.error(`Dinamik alan beyanı denetimi başarısız (${issues.length} bulgu, ${count} şema):`);
    issues.forEach(issue => console.error(`  - ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Dinamik alan beyanı denetimi: ${count} şema, bulgu yok.`);
}

/* Doğrudan koşum: `node scripts/component-contracts.mjs`. Modül olarak içe alındığında (sync-schema, üretici) bu blok
 * çalışmaz ve dosya sistemi modülleri yüklenmez. Üst düzey `await` yoktur: modül `require()` ile de alınabilir. */
if (typeof process !== "undefined" && typeof process.argv?.[1] === "string"
  && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/component-contracts.mjs")) {
  runDynamicFieldDeclarationCheck().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

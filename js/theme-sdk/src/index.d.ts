/**
 * @milofly/theme-sdk — types of the Milofly composition theme package (manifest v1) and helpers to keep a package as a
 * reviewable directory. The authoritative rules (component keys, settings, offerings, neutrality, languages, custom CSS)
 * live on the Milofly API; `milofly theme check` asks the API with the same validator the release writer uses.
 *
 * Field names mirror the API contract (`CompositionThemePackageManifestDto`, `ThemeExportDto`, `TemaSunumYazimIstegiDto`).
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface CatalogTranslation {
  name: string;
  description: string;
}

/** One component instance on a page. Text and language-bound links live in `defaultsByLang[lang]`. */
export interface ThemeComponent {
  componentKey: string;
  sortOrder: number;
  defaultSettings?: { [key: string]: Json };
  defaultItems?: Json[];
  defaultsByLang?: { [language: string]: { settings?: { [key: string]: Json }; items?: Json[] } };
  [extra: string]: unknown;
}

export interface ThemePage {
  systemPageKey: string;
  sortOrder: number;
  components: ThemeComponent[];
  [extra: string]: unknown;
}

export interface ThemeLayout {
  layoutType: "header" | "footer" | "popup" | (string & {});
  componentKey: string;
  sortOrder: number;
  defaultSettings?: { [key: string]: Json };
  defaultItems?: Json[];
  defaultsByLang?: { [language: string]: { settings?: { [key: string]: Json }; items?: Json[] } };
  [extra: string]: unknown;
}

export interface ThemeSetting {
  key: string;
  value: Json;
  [extra: string]: unknown;
}

export interface ThemeSnapshot {
  code?: string;
  catalogTranslations?: { [language: string]: CatalogTranslation };
  category?: string | null;
  thumbnailUrl?: string | null;
  sortOrder?: number;
  pages: ThemePage[];
  layouts: ThemeLayout[];
  settings: ThemeSetting[];
  [extra: string]: unknown;
}

/** One offered part of a surface (`component`, `product_card_variant`, `modal_group`, `modal_variant`, `badge_*`, …). */
export interface OfferingItem {
  key: string;
  order?: number;
  default?: boolean;
  absent?: boolean;
  group?: string;
  [extra: string]: unknown;
}

export interface Offerings {
  surfaces: { [surfaceKey: string]: OfferingItem[] };
  [extra: string]: unknown;
}

/** Licence declaration of an asset (required). `url` (https) is required for every kind except `own`. */
export interface ThemeAssetLicense {
  kind: "own" | "ofl-1.1" | "apache-2.0" | "mit" | "isc" | "cc0-1.0" | "cc-by-4.0" | "commercial";
  holder: string;
  url?: string;
}

/**
 * One file the package carries. Icons: `icons/<name>.svg|png`, referenced from content as `paket:<path>` (an icon field or
 * `theme_config.icons.glyphs.*`). Fonts: `fonts/<name>.woff2`, one file per face; the theme uses the `family` name.
 * `sha256` is computed by `readThemeProject` from the file under `theme/assets/`.
 */
export interface ThemeAsset {
  path: string;
  kind: "icon" | "font";
  sha256: string;
  family?: string;
  weight?: number;
  style?: "normal" | "italic";
  /** Icon only: follows the icon color of where it sits (single-color SVG up to 16 KB). */
  tint?: boolean;
  license: ThemeAssetLicense;
}

export interface ThemePackageManifest {
  schemaVersion: 1;
  /** `{publisher}/{name}` — the publisher segment is your developer publisher key. */
  packageKey: string;
  /** SemVer; the same version can never be written twice with different content. */
  version: string;
  mode: "composition";
  localizationMode: "milofly-db";
  defaultLanguageCode: string;
  supportedLanguageCodes: string[];
  catalogTranslations: { [language: string]: CatalogTranslation };
  theme: ThemeSnapshot;
  offerings: Offerings;
  /** The package's own icons and fonts (optional). */
  assets?: { files: ThemeAsset[] };
  [extra: string]: unknown;
}

/** One finding. `code` is a Milofly code (`theme_package.*`, `THEME_*`) or, for the local shape check, `local.*`. */
export interface ThemeIssue {
  code: string;
  path: string;
  detail: string;
}

/** Answer of `POST /api/dev/theme-packages/validate`. */
export interface ThemeCheckReport {
  valid: boolean;
  /** Blocks writing a release. */
  release: ThemeIssue[];
  /** The release can be written but no store can install it. */
  install: ThemeIssue[];
  /** Blocks opening the package to all stores (offer, review approval): neutrality + languages. */
  publish: ThemeIssue[];
}

/** Local shape check (types only). Rules are checked by the API. */
export function checkManifestShape(manifest: unknown): ThemeIssue[];

/** Directory layout of a theme project. */
export declare const PROJECT_LAYOUT: Readonly<{
  root: "theme";
  package: "theme/package.json";
  theme: "theme/theme.json";
  pages: "theme/pages";
  layouts: "theme/layouts.json";
  settings: "theme/settings";
  offerings: "theme/offerings.json";
  assets: "theme/assets.json";
  assetFiles: "theme/assets";
}>;

/** Reads `theme/assets.json` and hashes every file under `theme/assets/`. `null` when the package has no assets. */
export function readThemeAssets(projectDir: string): Promise<{ files: ThemeAsset[] } | null>;

/** Absolute path of an asset file inside `theme/assets/`. */
export function assetFilePath(projectDir: string, assetPath: string): string;

/** Writes a manifest as a directory (one file per page and per setting; stable JSON). Existing page/setting files that are no
 * longer in the manifest are removed. Returns the written paths (relative to `projectDir`). */
export function writeThemeProject(projectDir: string, manifest: ThemePackageManifest): Promise<string[]>;

/** Reads a theme directory back into one manifest. Throws with the file name when a file is missing or not JSON. */
export function readThemeProject(projectDir: string): Promise<ThemePackageManifest>;

/** Canonical JSON (sorted keys, no whitespace): the same input always gives the same bytes. Useful for diffs and caching. */
export function canonicalJson(value: unknown): string;

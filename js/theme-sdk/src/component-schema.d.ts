/**
 * Component schema (`schema.json`) contract validators — the same functions the Milofly platform runs on its own components
 * (single source: the platform's component contract, `scripts/component-contracts.mjs`). Each returns a list of human-readable issues; empty = valid.
 * Uploading your own code components is not open yet (developer platform G6).
 */

export interface ComponentSchemaField {
  key: string;
  type: string;
  label_key?: string;
  setting_role?: string;
  content_role?: string;
  [extra: string]: unknown;
}

export interface ComponentSchema {
  componentKey: string;
  settingsSchema?: ComponentSchemaField[];
  itemsSchema?: ComponentSchemaField[];
  defaultSettings?: Record<string, unknown>;
  defaultsByLang?: Record<string, { settings?: Record<string, unknown>; items?: unknown[] }>;
  schemaLabels?: Record<string, Record<string, string>>;
  translations?: { languageCode: string; [extra: string]: unknown }[];
  [extra: string]: unknown;
}

export function defineComponentSchema<T extends ComponentSchema>(schema: T): T;

export function validateActiveLanguageCoverage(schema: ComponentSchema, activeLanguageCodes: string[], sourceName?: string): string[];
export function collectSchemaLabelReferences(schema: ComponentSchema): string[];
export function indexSchemaFragments(fragmentDocuments: [string, unknown][]): { byName: Map<string, unknown>; issues: string[] };
export function expandSchemaFragments(schema: ComponentSchema, fragmentsByName: Map<string, unknown>, sourceName?: string): { schema: ComponentSchema; issues: string[] };
export function validateSchemaFragments(schema: ComponentSchema, fragmentsByName: Map<string, unknown>, sourceName?: string): string[];
export function validateDynamicFieldDeclarations(
  schema: ComponentSchema,
  contract: unknown,
  sourceName?: string,
  options?: { yerelBeyanAcik?: boolean; canliBeyanAcik?: boolean; zenginMetinAcik?: boolean },
): string[];

/** The dynamic field contract (token pattern, local namespace, text field types). */
export declare const dynamicFieldContract: Readonly<Record<string, unknown>>;

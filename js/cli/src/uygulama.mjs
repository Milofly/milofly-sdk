// `milofly app init <dir>` — ilk uygulamanın (kurulum, webhook, gömülü sayfa, API çağrısı) bir kopyasını açar.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ILK_UYGULAMA } from "./sablon-yolu.mjs";
import { kalin, soluk, yaz, yesil } from "./arayuz.mjs";

const ATLANAN = new Set(["node_modules", "dist", ".env"]);

export async function init(secenekler, [hedef]) {
  if (!hedef) throw new Error("Usage: milofly app init <directory>");
  const kok = resolve(hedef);
  if (existsSync(kok) && readdirSync(kok).length > 0) throw new Error(`${kok} is not empty.`);
  const kaynak = fileURLToPath(ILK_UYGULAMA);
  if (!existsSync(join(kaynak, "package.json"))) throw new Error(`App template not found at ${kaynak}.`);

  cpSync(kaynak, kok, { recursive: true, filter: (yol) => !ATLANAN.has(yol.split(/[\\/]/).pop()) });
  const paket = JSON.parse(readFileSync(join(kok, "package.json"), "utf8"));
  paket.name = secenekler.name ?? hedef.split(/[\\/]/).pop();
  writeFileSync(join(kok, "package.json"), JSON.stringify(paket, null, 2) + "\n");

  yaz(`${yesil("✔")} App created in ${kok}`);
  yaz(`  ${kalin("Next")}: create the app in the developer portal › Apps, then follow ${join(hedef, "README.md")} (configuration, install, webhooks).`);
  yaz(soluk("  It uses @milofly/app-bridge and @milofly/app-server from the same SDK release."));
}

export const komutlar = { init };

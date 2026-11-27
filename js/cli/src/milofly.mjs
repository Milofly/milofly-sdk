#!/usr/bin/env node
// Milofly CLI — giriş noktası. Belge: https://developer.milofly.com/docs/cli
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { cikis, giris, kimim, URETIM_API } from "./oturum.mjs";
import { komutlar as tema } from "./tema.mjs";
import { komutlar as uygulama } from "./uygulama.mjs";
import { hataYaz, kalin, soluk, yaz } from "./arayuz.mjs";

const SURUM = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const YARDIM = `${kalin("milofly")} ${SURUM} — Milofly developer CLI

${kalin("Account")}
  milofly login [--api <url>] [--no-browser]   Sign in with your browser (no password in the terminal)
  milofly logout                               Close this machine's CLI session
  milofly whoami                               Show the signed-in developer and publisher key

${kalin("Themes")} (composition themes, built in your development store)
  milofly theme init [dir] [--store <id>] [--theme <id>] [--name <name>]
  milofly theme pull                           Bring the theme from your development store into theme/
  milofly theme check [--json]                 Validate with the Milofly rules (release, install, publishing)
  milofly theme dev                            Push every change to your development store and publish it there
  milofly theme push [--activate]              Write the version in theme/package.json as a draft release and install it
  milofly theme pack                           Write dist/<package>-<version>.json (no upload)
  milofly theme submit [--version <x>]         Send a pushed version to Milofly review
  milofly theme list [--all]                   Your theme packages and releases

${kalin("Apps")}
  milofly app init <dir>                       Start from the first-app template (install, webhooks, embedded page)

${kalin("Options")}
  --path <dir>     Theme project folder (default: current folder)
  --api <url>      Milofly API (default after login: the one you signed in to; first login: ${URETIM_API})
  MILOFLY_LANG     Language of Milofly error messages (tr, en, de, fr, ar)
`;

const { values: secenekler, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    api: { type: "string" },
    path: { type: "string" },
    store: { type: "string" },
    theme: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    activate: { type: "boolean" },
    all: { type: "boolean" },
    json: { type: "boolean" },
    "no-browser": { type: "boolean" },
    help: { type: "boolean", short: "h" },
    v: { type: "boolean" },
  },
});

const [grup, alt, ...kalan] = positionals;

async function main() {
  if (secenekler.v) return yaz(SURUM);
  if (!grup || secenekler.help) return yaz(YARDIM);
  if (grup === "login") return giris(secenekler);
  if (grup === "logout") return cikis(secenekler);
  if (grup === "whoami") return kimim(secenekler);
  const tablo = grup === "theme" ? tema : grup === "app" ? uygulama : null;
  if (!tablo) throw new Error(`Unknown command "${grup}". Run "milofly --help".`);
  const komut = tablo[alt];
  if (!komut) throw new Error(`Unknown command "${grup} ${alt ?? ""}". Run "milofly --help".`);
  return komut(secenekler, kalan);
}

main().catch((hata) => {
  hataYaz(hata.message);
  if (process.env.MILOFLY_DEBUG) yaz(soluk(hata.stack));
  process.exitCode = 1;
});

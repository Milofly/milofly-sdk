// Kimlik kasası — CLI'ın yenileme jetonunu işletim sisteminin gizli deposunda tutar. Parola hiç görülmez ve saklanmaz.
//
//   Windows : DPAPI (geçerli kullanıcı) ile şifrelenmiş dosya, ~/.milofly/credentials.<ad>.dpapi
//   macOS   : Anahtar Zinciri (security add-generic-password / find-generic-password)
//   Linux   : Secret Service (secret-tool); yoksa ~/.milofly/credentials.<ad>.json, yalnız sahibi okur (0600) — bu durum her girişte
//             açıkça yazılır (`konum`).
// Kayıt anahtarı API kökenidir: aynı makinede canlı ve yerel Milofly'a ayrı oturum açılabilir.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HIZMET = "milofly-cli";
export const KLASOR = join(homedir(), ".milofly");

function ad(api) {
  return createHash("sha256").update(api).digest("hex").slice(0, 16);
}

function calistir(komut, argumanlar, girdi) {
  const s = spawnSync(komut, argumanlar, { input: girdi, encoding: "utf8", windowsHide: true });
  if (s.error) return { ok: false, cikti: "", hata: s.error.message, yok: s.error.code === "ENOENT" };
  return { ok: s.status === 0, cikti: (s.stdout ?? "").trim(), hata: (s.stderr ?? "").trim(), yok: false };
}

function powershell(betik, girdi) {
  return calistir("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", betik], girdi);
}

const DPAPI_YAZ =
  "Add-Type -AssemblyName System.Security; $g=[Console]::In.ReadToEnd(); " +
  "$b=[Text.Encoding]::UTF8.GetBytes($g); " +
  "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const DPAPI_OKU =
  "Add-Type -AssemblyName System.Security; $g=[Console]::In.ReadToEnd().Trim(); " +
  "$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($g),$null,'CurrentUser'); " +
  "[Text.Encoding]::UTF8.GetString($b)";

function linuxSecretTool() {
  return calistir("secret-tool", ["--version"]).yok ? null : "secret-tool";
}

/** Kasanın nerede tuttuğu (girişte kullanıcıya söylenir). */
export function konum() {
  if (process.platform === "win32") return "Windows DPAPI (current user)";
  if (process.platform === "darwin") return "macOS Keychain";
  return linuxSecretTool() ? "Secret Service (secret-tool)" : `${join(KLASOR, "credentials.*.json")} (0600, no keyring found)`;
}

/** @param {string} api @param {object} kayit */
export function yaz(api, kayit) {
  mkdirSync(KLASOR, { recursive: true, mode: 0o700 });
  const metin = JSON.stringify(kayit);
  if (process.platform === "win32") {
    const r = powershell(DPAPI_YAZ, metin);
    if (!r.ok) throw new Error(`Could not encrypt credentials with DPAPI: ${r.hata}`);
    writeFileSync(join(KLASOR, `credentials.${ad(api)}.dpapi`), r.cikti, { mode: 0o600 });
    return;
  }
  if (process.platform === "darwin") {
    const r = calistir("security", ["add-generic-password", "-U", "-s", HIZMET, "-a", api, "-w", metin]);
    if (!r.ok) throw new Error(`Could not write to the macOS Keychain: ${r.hata}`);
    return;
  }
  if (linuxSecretTool()) {
    const r = calistir("secret-tool", ["store", `--label=Milofly CLI (${api})`, "service", HIZMET, "account", api], metin);
    if (!r.ok) throw new Error(`Could not write to the Secret Service: ${r.hata}`);
    return;
  }
  const dosya = join(KLASOR, `credentials.${ad(api)}.json`);
  writeFileSync(dosya, metin, { mode: 0o600 });
  chmodSync(dosya, 0o600);
}

/** @param {string} api @returns {object|null} */
export function oku(api) {
  if (process.platform === "win32") {
    const dosya = join(KLASOR, `credentials.${ad(api)}.dpapi`);
    if (!existsSync(dosya)) return null;
    const r = powershell(DPAPI_OKU, readFileSync(dosya, "utf8"));
    if (!r.ok) throw new Error(`Could not decrypt credentials (DPAPI): ${r.hata}. Run "milofly login" again.`);
    return JSON.parse(r.cikti);
  }
  if (process.platform === "darwin") {
    const r = calistir("security", ["find-generic-password", "-s", HIZMET, "-a", api, "-w"]);
    return r.ok && r.cikti ? JSON.parse(r.cikti) : null;
  }
  if (linuxSecretTool()) {
    const r = calistir("secret-tool", ["lookup", "service", HIZMET, "account", api]);
    return r.ok && r.cikti ? JSON.parse(r.cikti) : null;
  }
  const dosya = join(KLASOR, `credentials.${ad(api)}.json`);
  return existsSync(dosya) ? JSON.parse(readFileSync(dosya, "utf8")) : null;
}

/** @param {string} api */
export function sil(api) {
  if (process.platform === "win32") return rmSync(join(KLASOR, `credentials.${ad(api)}.dpapi`), { force: true });
  if (process.platform === "darwin") return void calistir("security", ["delete-generic-password", "-s", HIZMET, "-a", api]);
  if (linuxSecretTool()) return void calistir("secret-tool", ["clear", "service", HIZMET, "account", api]);
  rmSync(join(KLASOR, `credentials.${ad(api)}.json`), { force: true });
}

// Terminal yardımcıları: yazdırma, soru sorma, listeden seçme, tarayıcı açma. Bağımlılık yok.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";

const renk = stdout.isTTY && !process.env.NO_COLOR;
const boya = (kod, metin) => (renk ? `\x1b[${kod}m${metin}\x1b[0m` : metin);
export const kalin = (m) => boya("1", m);
export const soluk = (m) => boya("2", m);
export const yesil = (m) => boya("32", m);
export const kirmizi = (m) => boya("31", m);
export const sari = (m) => boya("33", m);

export const yaz = (m = "") => stdout.write(`${m}\n`);
export const uyar = (m) => stderr.write(`${sari("!")} ${m}\n`);
export const hataYaz = (m) => stderr.write(`${kirmizi("✖")} ${m}\n`);

/** Etkileşimli değilse (CI) soru sorulmaz: eksik bilgi bayrakla verilmelidir. */
function etkilesimliMi(neIcin) {
  if (stdin.isTTY) return;
  throw new Error(`${neIcin} is required (non-interactive terminal: pass it as a flag).`);
}

export async function sor(soru, { varsayilan } = {}) {
  etkilesimliMi(soru);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const cevap = (await rl.question(`${soru}${varsayilan ? soluk(` (${varsayilan})`) : ""}: `)).trim();
    return cevap || varsayilan || "";
  } finally {
    rl.close();
  }
}

/** @template T @param {string} baslik @param {T[]} ogeler @param {(o: T) => string} etiket @returns {Promise<T>} */
export async function sec(baslik, ogeler, etiket) {
  if (ogeler.length === 0) throw new Error(`${baslik}: nothing to choose from.`);
  if (ogeler.length === 1) {
    yaz(`${baslik}: ${etiket(ogeler[0])}`);
    return ogeler[0];
  }
  etkilesimliMi(baslik);
  yaz(kalin(baslik));
  ogeler.forEach((o, i) => yaz(`  ${i + 1}) ${etiket(o)}`));
  for (;;) {
    const n = Number(await sor("Number"));
    if (Number.isInteger(n) && n >= 1 && n <= ogeler.length) return ogeler[n - 1];
  }
}

/** Varsayılan tarayıcıda açar; açamazsa adres zaten yazılmıştır. */
export function tarayiciAc(adres) {
  const [komut, argumanlar] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", adres.replaceAll("&", "^&")]]
    : process.platform === "darwin" ? ["open", [adres]]
    : ["xdg-open", [adres]];
  try {
    const c = spawn(komut, argumanlar, { stdio: "ignore", detached: true, windowsHide: true });
    c.on("error", () => {});
    c.unref();
  } catch {
    // Tarayıcı açılamadı: adres terminalde yazılı, kullanıcı elle açar.
  }
}

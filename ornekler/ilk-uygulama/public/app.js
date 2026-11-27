// The page Milofly embeds in the store panel.
import { createApp, MiloflyBridgeError } from "@milofly/app-bridge";

const $ = (id) => document.getElementById(id);
const status = (text, state) => {
  $("status").textContent = text;
  $("status").dataset.state = state;
};
const show = (value) => ($("out").textContent = JSON.stringify(value, null, 2));

// @belge:kopru-baslat
let app;
try {
  // In production list the panel origin(s) you accept, e.g. ["https://app.milofly.com"].
  app = await createApp();
} catch (err) {
  // Opened outside the panel, or the panel did not answer.
  status(err instanceof MiloflyBridgeError ? `Not connected (${err.code}).` : String(err), "error");
  throw err;
}
status(`Connected: store ${app.storeContext.storeId}, region ${app.storeContext.regionId}, ${app.uiLocale} (${app.surface}).`, "ready");
if (app.initialPath) show({ initialPath: app.initialPath });

/** Calls YOUR server with the session token; your server verifies it (verifySessionToken). */
async function callBackend(path) {
  const token = await app.getSessionToken(); // renewed through the panel before it expires
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-Milofly-Host": app.hostOrigin },
  });
  return { status: res.status, body: await res.json() };
}
// @belge-son

$("load").addEventListener("click", async () => show(await callBackend("/api/session")));

// @belge:kopru-eylemleri
$("toast").addEventListener("click", () => app.toast("Saved from the app", { tone: "success" }));
$("confirm").addEventListener("click", async () => {
  const confirmed = await app.confirm({ title: "Sync products?", message: "Prices and stock will be updated.", confirmLabel: "Sync" });
  show({ confirmed });
});
$("order").addEventListener("click", () => app.redirect("order", 1));
$("page").addEventListener("click", async () => {
  if (!app.supports("navigate")) return show({ navigate: "not offered on this surface" });
  // Call this whenever your router changes screens: the panel address follows, so a reload or a
  // shared link opens the same screen (it comes back as app.initialPath).
  await app.navigate("/settings");
  show({ path: "/settings" });
});
// @belge-son

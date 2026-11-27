// `milofly app init`'in kopyaladığı başlangıç uygulamasının yeri. Depo içinde örneğin KENDİSİDİR (tek kaynak:
// milofly.sdk/ornekler/ilk-uygulama); yayın paketinde paketle.mjs örneği dist/templates/first-app'e kopyalar ve bu dosyayı oraya
// gösterecek biçimde yeniden yazar.
export const ILK_UYGULAMA = new URL("../../../ornekler/ilk-uygulama/", import.meta.url);

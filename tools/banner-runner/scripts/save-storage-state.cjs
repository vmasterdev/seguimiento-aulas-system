const { chromium } = require("playwright");

async function main() {
  const endpoint = process.env.BANNER_REMOTE_DEBUGGING_URL || "http://127.0.0.1:9222";
  const outputPath = process.env.BANNER_STORAGE_STATE_PATH || "storage/auth/banner-storage-state.json";

  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("No se encontro un contexto activo en el navegador remoto");
  }

  await context.storageState({ path: outputPath });
  console.log(JSON.stringify({ outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

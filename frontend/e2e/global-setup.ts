export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/actuator/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).status === "UP") return;
    } catch {
      /* Wait for the real application's database/migration startup. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `NexaPay is not ready at ${base}; start the real backend/database before E2E.`,
  );
}

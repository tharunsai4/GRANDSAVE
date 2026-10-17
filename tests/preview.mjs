// Optional local browser QA. The printed account exists only in this in-memory
// HTTP fixture. All records are discarded when this process stops.
import { fakePassword, owner, startProductionApp, startSupabaseFixture } from "./fixture.mjs";

let fixture;
let app;
try {
  fixture = await startSupabaseFixture();
  app = await startProductionApp(fixture);
  console.log(`Local test preview: ${app.url}`);
  console.log(`Test email: ${owner.email}`);
  console.log(`Test password: ${fakePassword}`);
  console.log("Uses a local mock only. Stop with Ctrl+C; test records will be discarded.");
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
} finally {
  if (app) await app.close();
  if (fixture) await fixture.close();
}

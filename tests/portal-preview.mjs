// Disposable local browser QA only. Never contacts a Supabase project.
import { fixturePassword, owner, startPortalApp, startPortalFixture } from './portal-http-fixture.mjs';
let fixture, app;
try {
  fixture = await startPortalFixture();
  app = await startPortalApp(fixture);
  console.log(`Local portal QA: ${app.url}`);
  console.log(`Fake owner: ${owner.email}; fake customer key: shop-one`);
  console.log(`Fake password: ${fixturePassword}`);
  await new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await app?.close();
  await fixture?.close();
}

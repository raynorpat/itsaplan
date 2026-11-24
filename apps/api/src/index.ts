import { app } from './app';
import { sweepInterruptedImports } from './imports/store';

// Bind the port. The app itself is assembled in ./app.ts (without `.listen()`)
// so tests can import it and drive routes in memory.
// An import running when the process stopped cannot continue (its token was in
// memory), so it ends as an error before the app serves.
await sweepInterruptedImports();
app.listen(Number(process.env.API_PORT ?? 3000));

console.log(`🦊 API running at http://${app.server?.hostname}:${app.server?.port}`);

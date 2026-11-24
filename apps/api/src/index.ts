import { app } from './app';
import { expireWaitingImports } from './imports/flow';
import { sweepInterruptedImports } from './imports/store';

// Bind the port. The app itself is assembled in ./app.ts (without `.listen()`)
// so tests can import it and drive routes in memory.
// An import running when the process stopped cannot continue (its token was in
// memory), so it ends as an error before the app serves.
await sweepInterruptedImports();
// Fetched import data waiting a day for the people matching is dropped.
setInterval(() => void expireWaitingImports().catch(console.error), 60 * 60 * 1000);
app.listen(Number(process.env.API_PORT ?? 3000));

console.log(`🦊 API running at http://${app.server?.hostname}:${app.server?.port}`);

// Page entry point. Lives in a file rather than inline in index.html so the
// CSP can say script-src 'self' with no inline allowance — on a page that
// renders attacker-supplied strings, "no inline script executes, ever" is a
// guarantee worth having twice (the renderer already never parses markup).
import { boot, wireFileInput } from './main.js';

wireFileInput(await boot());

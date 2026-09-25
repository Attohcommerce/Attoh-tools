/* Node-loader die `import { x } from "./brands"` laat werken zoals Next.js dat
   doet. Zonder dit kan een kaal `node scripts/verdeling-test.mjs` de engine
   niet inladen (Node ESM eist een extensie). Geen dependencies. */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      for (const suffix of [".js", ".mjs", "/index.js"]) {
        try {
          return await next(specifier + suffix, context);
        } catch {}
      }
    }
    throw err;
  }
}

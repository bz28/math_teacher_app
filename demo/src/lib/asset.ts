// Prefix a runtime asset path (screenshots, the film) with the app's base so
// it resolves whether the demo is served at the root (dev / its own domain) or
// mounted under /tour on veradicai.com. `import.meta.env.BASE_URL` is Vite's
// configured `base` — "/" in dev, "/tour/" in the production build. Vite
// rewrites asset URLs it can see at build time (imports, index.html), but these
// paths live in JSON data / hardcoded strings, so they need this at runtime.
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
}

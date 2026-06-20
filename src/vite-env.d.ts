/// <reference types="vite/client" />

declare module 'kalidokit/dist/kalidokit.es.js' {
  export const Face: { solve?: (...args: unknown[]) => unknown };
  export const Pose: { solve?: (...args: unknown[]) => unknown };
  export const Hand: { solve?: (...args: unknown[]) => unknown };
}

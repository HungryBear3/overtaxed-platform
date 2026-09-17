/**
 * Node-side stand-in for the `server-only` marker package.
 *
 * Next.js aliases `server-only` inside its own build, so the runtime modules
 * that import it cannot be loaded by a plain Node script without a mapping.
 * This module is wired in ONLY through `tsconfig.acceptance.json`, which the
 * Preview synthetic-acceptance command passes to `tsx`. The application build
 * and the type check keep Next's real resolution, so the marker still does its
 * job everywhere it matters.
 */
export {}

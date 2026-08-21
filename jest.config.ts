import type { Config } from "jest"
import nextJest from "next/jest.js"

const createJestConfig = nextJest({ dir: "./" })

const config: Config = {
  testEnvironment: "jsdom",
  testMatch: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/visual/"],
  passWithNoTests: true,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
}

/**
 * `next/jest` sets its own `transformIgnorePatterns` and overrides whatever the
 * user config supplies, so the list has to be replaced after it resolves.
 *
 * The reason it has to be replaced at all: `lib/blog` is the single source every
 * blog consumer derives from — the dynamic route, the `/blog` listing,
 * `rss.xml` and the sitemap — so the served-blog governance suite imports it
 * rather than re-implementing the derivation. Re-implementing is what produced
 * the defect that suite exists to prevent. `lib/blog` pulls in `remark` and
 * `unified`, which ship ESM only, and Jest does not transform `node_modules` by
 * default.
 *
 * Only that dependency chain is allowed through. Everything else in
 * `node_modules` is still ignored.
 */
const ESM_DEPENDENCIES = [
  "remark",
  "remark-.*",
  "unified",
  "unist-.*",
  "mdast-.*",
  "micromark",
  "micromark-.*",
  "vfile",
  "vfile-.*",
  "hast-.*",
  "property-information",
  "space-separated-tokens",
  "comma-separated-tokens",
  "html-void-elements",
  "zwitch",
  "bail",
  "trough",
  "is-plain-obj",
  "devlop",
  "ccount",
  "escape-string-regexp",
  "longest-streak",
  "markdown-table",
  "stringify-entities",
  "parse-entities",
  "character-entities",
  "character-entities-.*",
  "character-reference-invalid",
  "decode-named-character-reference",
  "is-alphabetical",
  "is-alphanumerical",
  "is-decimal",
  "is-hexadecimal",
  "web-namespaces",
  "trim-lines",
]

const resolved = createJestConfig(config)

export default async (): Promise<Config> => {
  const next = await resolved()
  return {
    ...next,
    transformIgnorePatterns: [
      `/node_modules/(?!(${ESM_DEPENDENCIES.join("|")})/)`,
      "^.+\\.module\\.(css|sass|scss)$",
    ],
  }
}

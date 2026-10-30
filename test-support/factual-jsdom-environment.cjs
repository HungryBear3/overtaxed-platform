// Opt-in only for the mounted factual evidence suite. Keep real Node Web APIs;
// do not replace the producer, route or fetch with canned success responses.
const { TestEnvironment } = require("jest-environment-jsdom")
const { Request, Response, Headers, structuredClone } = globalThis

module.exports = class FactualJSDOMEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context)
    Object.assign(this.global, { Request, Response, Headers, structuredClone })
  }
}

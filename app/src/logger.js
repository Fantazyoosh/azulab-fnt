const pino = require("pino");
const pkg = require("../package.json");

function createLogger(level = "info") {
  return pino({
    level,
    base: { service: "azulab", version: pkg.version },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

module.exports = { createLogger };

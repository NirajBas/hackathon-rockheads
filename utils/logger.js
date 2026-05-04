const format = (level, ...args) => {
  const timestamp = new Date().toISOString();
  return [`[${timestamp}]`, `[${level}]`, ...args];
};

const logger = {
  log: (...args) => console.log(...format("INFO", ...args)),
  warn: (...args) => console.warn(...format("WARN", ...args)),
  error: (...args) => console.error(...format("ERROR", ...args))
};

module.exports = logger;

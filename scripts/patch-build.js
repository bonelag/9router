const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  const exports = originalRequire.apply(this, arguments);
  if (id.includes('@vercel/nft')) {
    try {
      const originalNodeFileTrace = exports.nodeFileTrace;
      if (originalNodeFileTrace) {
        const wrappedNodeFileTrace = function(files, options) {
          if (options && options.ignore) {
            const originalIgnore = options.ignore;
            options.ignore = function(p) {
              if (typeof p === 'string') {
                const normalized = p.replace(/\\/g, '/');
                if (
                  normalized.includes('Administrator') ||
                  normalized.includes('Application Data') ||
                  normalized.includes('Cookies')
                ) {
                  return true;
                }
              }
              return originalIgnore.call(this, p);
            };
          }
          return originalNodeFileTrace.apply(this, arguments);
        };
        
        Object.defineProperty(exports, 'nodeFileTrace', {
          value: wrappedNodeFileTrace,
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
    } catch (e) {
      console.error('Failed to wrap nodeFileTrace:', e);
    }
  }
  return exports;
};

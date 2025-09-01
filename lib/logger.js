// lib/logger.js
class Logger {
  constructor(serviceName = 'mpesa-integration') {
    this.serviceName = serviceName;
  }

  log(level, message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...metadata,
      // Remove PII from logs 
      ...(metadata.phone ? { phone: '***' + metadata.phone.slice(-3) } : {})
    };
    
    console.log(JSON.stringify(logEntry));
  }

  debug(message, metadata = {}) {
    this.log('debug', message, metadata);
  }

  info(message, metadata = {}) {
    this.log('info', message, metadata);
  }

  warn(message, metadata = {}) {
    this.log('warn', message, metadata);
  }

  error(message, metadata = {}) {
    this.log('error', message, metadata);
  }

  // Add request ID tracking 
  withRequestId(requestId) {
    return new Proxy(this, {
      get: (target, prop) => {
        if (['debug', 'info', 'warn', 'error', 'log'].includes(prop)) {
          return (message, metadata = {}) => 
            target[prop](message, { ...metadata, requestId });
        }
        return target[prop];
      }
    });
  }
}

export default Logger;
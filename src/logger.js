/**
 * Winston logger configuration
 * Logs to console and file, excludes sensitive data
 * @module logger
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Custom format to exclude sensitive data
 */
const sensitiveDataFilter = winston.format((info) => {
  // Remove any potential sensitive data from log messages
  if (info.message) {
    info.message = info.message
      .replace(/li_at=[^;\s]+/gi, 'li_at=***REDACTED***')
      .replace(/MASTER_KEY=[^\s]+/gi, 'MASTER_KEY=***REDACTED***')
      .replace(/password[=:]\s*[^\s]+/gi, 'password=***REDACTED***');
  }
  return info;
});

/**
 * Winston logger instance
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    sensitiveDataFilter(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'linkedin-scraper' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    }),
    // Write all logs to file
    new winston.transports.File({
      filename: path.join(logDir, 'scraper.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    // Write errors to separate file
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
  // Don't exit on handled exceptions
  exitOnError: false,
});

/**
 * Log request with sanitized data
 * @param {string} url - Request URL
 * @param {number} status - HTTP status code
 * @param {Object} metadata - Additional metadata
 */
function logRequest(url, status, metadata = {}) {
  logger.info('Request completed', {
    url: sanitizeUrl(url),
    status,
    ...metadata,
  });
}

/**
 * Log error with sanitized data
 * @param {string} message - Error message
 * @param {Error} error - Error object
 * @param {Object} metadata - Additional metadata
 */
function logError(message, error, metadata = {}) {
  logger.error(message, {
    error: error.message,
    stack: error.stack,
    ...metadata,
  });
}

/**
 * Sanitize URL to remove sensitive query parameters
 * @param {string} url - URL to sanitize
 * @returns {string} Sanitized URL
 */
function sanitizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove potentially sensitive query params
    urlObj.searchParams.delete('authToken');
    urlObj.searchParams.delete('token');
    return urlObj.toString();
  } catch {
    return url;
  }
}

module.exports = {
  logger,
  logRequest,
  logError,
  sanitizeUrl,
};


/**
 * LOGGING & MONITORING LAYER
 * Comprehensive logging with daily reports and alerts
 */

const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const LOG_DIR = path.join(__dirname, '../data/logs');
const DAILY_REPORT_DIR = path.join(__dirname, '../data/reports');

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
};

const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

/**
 * Ensure log directories exist
 */
const ensureLogDirs = async () => {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.mkdir(DAILY_REPORT_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating log directories:', error.message);
  }
};

/**
 * Format log entry
 */
const formatLogEntry = (level, message, metadata = {}) => {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    level,
    message,
    ...metadata,
  };
};

/**
 * Write log to file
 */
const writeLog = async (level, message, metadata = {}) => {
  try {
    await ensureLogDirs();
    
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `${today}.log`);
    
    const entry = formatLogEntry(level, message, metadata);
    const logLine = JSON.stringify(entry) + '\n';
    
    await fs.appendFile(logFile, logLine);
  } catch (error) {
    console.error('Error writing log:', error.message);
  }
};

/**
 * Log levels
 */
const debug = (message, metadata) => {
  if (LOG_LEVELS[CURRENT_LOG_LEVEL] <= LOG_LEVELS.DEBUG) {
    console.debug(`[DEBUG] ${message}`, metadata || '');
  }
  writeLog('DEBUG', message, metadata);
};

const info = (message, metadata) => {
  if (LOG_LEVELS[CURRENT_LOG_LEVEL] <= LOG_LEVELS.INFO) {
    console.log(`[INFO] ${message}`, metadata || '');
  }
  writeLog('INFO', message, metadata);
};

const warn = (message, metadata) => {
  if (LOG_LEVELS[CURRENT_LOG_LEVEL] <= LOG_LEVELS.WARN) {
    console.warn(`[WARN] ${message}`, metadata || '');
  }
  writeLog('WARN', message, metadata);
};

const error = (message, metadata) => {
  if (LOG_LEVELS[CURRENT_LOG_LEVEL] <= LOG_LEVELS.ERROR) {
    console.error(`[ERROR] ${message}`, metadata || '');
  }
  writeLog('ERROR', message, metadata);
};

const critical = (message, metadata) => {
  console.error(`[CRITICAL] ${message}`, metadata || '');
  writeLog('CRITICAL', message, metadata);
  
  // Send alert for critical errors
  sendAlert(message, metadata);
};

/**
 * Log request
 */
const logRequest = async (url, status, metadata = {}) => {
  await writeLog('INFO', 'Request', {
    type: 'request',
    url,
    status,
    ...metadata,
  });
};

/**
 * Log error response
 */
const logError = async (url, statusCode, errorType, metadata = {}) => {
  const level = statusCode === 403 ? 'CRITICAL' : statusCode === 429 ? 'WARN' : 'ERROR';
  await writeLog(level, 'Request Error', {
    type: 'error',
    url,
    statusCode,
    errorType,
    ...metadata,
  });
  
  if (statusCode === 403) {
    critical('403 Forbidden - Account may be restricted', { url, ...metadata });
  }
};

/**
 * Generate daily report
 */
const generateDailyReport = async () => {
  try {
    await ensureLogDirs();
    
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `${today}.log`);
    
    let requests = 0;
    let errors = 0;
    let views = 0;
    let profilesExtracted = 0;
    const errorBreakdown = {
      '403': 0,
      '429': 0,
      'network': 0,
      'other': 0,
    };
    
    try {
      const logContent = await fs.readFile(logFile, 'utf8');
      const lines = logContent.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          if (entry.type === 'request') {
            requests++;
            if (entry.metadata?.view) views++;
            if (entry.metadata?.profileExtracted) profilesExtracted++;
          }
          
          if (entry.type === 'error') {
            errors++;
            const statusCode = entry.statusCode?.toString() || 'other';
            if (errorBreakdown[statusCode] !== undefined) {
              errorBreakdown[statusCode]++;
            } else {
              errorBreakdown.other++;
            }
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    const report = {
      date: today,
      summary: {
        requests,
        views,
        profilesExtracted,
        errors,
        errorBreakdown,
      },
      generatedAt: new Date().toISOString(),
    };
    
    const reportFile = path.join(DAILY_REPORT_DIR, `report-${today}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    
    info('Daily report generated', { report });
    
    return report;
  } catch (error) {
    console.error('Error generating daily report:', error.message);
    return null;
  }
};

/**
 * Send alert (placeholder for Slack/Email integration)
 */
const sendAlert = async (message, metadata = {}) => {
  // TODO: Integrate with Slack/Email service
  // For now, just log as critical
  critical(`ALERT: ${message}`, metadata);
  
  // Example Slack webhook integration:
  // if (process.env.SLACK_WEBHOOK_URL) {
  //   await axios.post(process.env.SLACK_WEBHOOK_URL, {
  //     text: `🚨 LinkedIn Scraper Alert: ${message}`,
  //     attachments: [{ text: JSON.stringify(metadata, null, 2) }],
  //   });
  // }
};

/**
 * Archive old logs (keep last 30 days)
 */
const archiveOldLogs = async () => {
  try {
    const files = await fs.readdir(LOG_DIR);
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    
    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      const stats = await fs.stat(filePath);
      
      if (stats.mtime.getTime() < thirtyDaysAgo) {
        await fs.unlink(filePath);
        info('Archived old log file', { file });
      }
    }
  } catch (error) {
    console.error('Error archiving logs:', error.message);
  }
};

// Generate daily report at midnight
const scheduleDailyReport = () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  
  const msUntilMidnight = tomorrow.getTime() - now.getTime();
  
  setTimeout(() => {
    generateDailyReport();
    archiveOldLogs();
    
    // Schedule for next day
    setInterval(() => {
      generateDailyReport();
      archiveOldLogs();
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
};

// Initialize
ensureLogDirs();
scheduleDailyReport();

module.exports = {
  debug,
  info,
  warn,
  error,
  critical,
  logRequest,
  logError,
  generateDailyReport,
  sendAlert,
  archiveOldLogs,
};


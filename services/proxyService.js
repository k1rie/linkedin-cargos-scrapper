/**
 * PROXY LAYER - Residential proxy rotation with sticky sessions
 * Supports Bright Data, Oxylabs, and custom proxy providers
 */

const axios = require('axios');
require('dotenv').config();

// Proxy configuration
const PROXY_ENABLED = process.env.PROXY_ENABLED === 'true';
const PROXY_TYPE = process.env.PROXY_TYPE || 'none'; // 'brightdata', 'oxylabs', 'custom', 'none'
const PROXY_STICKY_SESSION_DURATION = parseInt(process.env.PROXY_STICKY_SESSION_DURATION || '7200000'); // 2 hours default

// Bright Data configuration
const BRIGHT_DATA_USERNAME = process.env.BRIGHT_DATA_USERNAME;
const BRIGHT_DATA_PASSWORD = process.env.BRIGHT_DATA_PASSWORD;
const BRIGHT_DATA_ENDPOINT = process.env.BRIGHT_DATA_ENDPOINT || 'brd.superproxy.io:22225';

// Oxylabs configuration
const OXYLABS_USERNAME = process.env.OXYLABS_USERNAME;
const OXYLABS_PASSWORD = process.env.OXYLABS_PASSWORD;
const OXYLABS_ENDPOINT = process.env.OXYLABS_ENDPOINT || 'pr.oxylabs.io:7777';

// Custom proxy configuration
const CUSTOM_PROXY_URL = process.env.CUSTOM_PROXY_URL; // Format: http://user:pass@host:port

// Session tracking for sticky proxies
const activeSessions = new Map(); // sessionId -> { proxy, startTime, requestCount }

/**
 * Get proxy configuration for a session
 */
const getProxyConfig = (sessionId = 'default') => {
  if (!PROXY_ENABLED || PROXY_TYPE === 'none') {
    return null;
  }

  // Check if we have an active sticky session
  const activeSession = activeSessions.get(sessionId);
  if (activeSession) {
    const sessionAge = Date.now() - activeSession.startTime;
    if (sessionAge < PROXY_STICKY_SESSION_DURATION) {
      activeSession.requestCount++;
      return activeSession.proxy;
    } else {
      // Session expired, remove it
      activeSessions.delete(sessionId);
    }
  }

  // Create new proxy configuration
  let proxyConfig = null;

  switch (PROXY_TYPE) {
    case 'brightdata':
      if (!BRIGHT_DATA_USERNAME || !BRIGHT_DATA_PASSWORD) {
        console.warn('⚠️  Bright Data credentials not configured');
        return null;
      }
      proxyConfig = {
        server: `http://${BRIGHT_DATA_ENDPOINT}`,
        username: BRIGHT_DATA_USERNAME,
        password: BRIGHT_DATA_PASSWORD,
        // Sticky session: same IP for session duration
        // Bright Data uses session-{sessionId} in username
      };
      // Bright Data sticky session format: username-session-{sessionId}
      proxyConfig.username = `${BRIGHT_DATA_USERNAME}-session-${sessionId}`;
      break;

    case 'oxylabs':
      if (!OXYLABS_USERNAME || !OXYLABS_PASSWORD) {
        console.warn('⚠️  Oxylabs credentials not configured');
        return null;
      }
      proxyConfig = {
        server: `http://${OXYLABS_ENDPOINT}`,
        username: OXYLABS_USERNAME,
        password: OXYLABS_PASSWORD,
      };
      // Oxylabs sticky session: add session parameter
      proxyConfig.server = `${proxyConfig.server}?session_id=${sessionId}`;
      break;

    case 'custom':
      if (!CUSTOM_PROXY_URL) {
        console.warn('⚠️  Custom proxy URL not configured');
        return null;
      }
      try {
        const url = new URL(CUSTOM_PROXY_URL);
        proxyConfig = {
          server: `${url.protocol}//${url.host}`,
          username: url.username || undefined,
          password: url.password || undefined,
        };
      } catch (error) {
        console.error('❌ Invalid custom proxy URL:', error.message);
        return null;
      }
      break;

    default:
      return null;
  }

  // Store active session
  if (proxyConfig) {
    activeSessions.set(sessionId, {
      proxy: proxyConfig,
      startTime: Date.now(),
      requestCount: 1,
    });
  }

  return proxyConfig;
};

/**
 * Get Playwright proxy configuration
 */
const getPlaywrightProxy = (sessionId = 'default') => {
  const proxyConfig = getProxyConfig(sessionId);
  if (!proxyConfig) {
    return undefined;
  }

  return {
    server: proxyConfig.server,
    username: proxyConfig.username,
    password: proxyConfig.password,
  };
};

/**
 * Clear expired sessions
 */
const clearExpiredSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    const sessionAge = now - session.startTime;
    if (sessionAge >= PROXY_STICKY_SESSION_DURATION) {
      activeSessions.delete(sessionId);
    }
  }
};

/**
 * Get session statistics
 */
const getSessionStats = () => {
  clearExpiredSessions();
  return {
    activeSessions: activeSessions.size,
    sessions: Array.from(activeSessions.entries()).map(([id, session]) => ({
      sessionId: id,
      age: Date.now() - session.startTime,
      requestCount: session.requestCount,
    })),
  };
};

// Clean up expired sessions every hour
setInterval(clearExpiredSessions, 3600000);

module.exports = {
  getProxyConfig,
  getPlaywrightProxy,
  clearExpiredSessions,
  getSessionStats,
  PROXY_ENABLED,
  PROXY_TYPE,
};


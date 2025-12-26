/**
 * RATE LIMITING LAYER
 * Daily limits, random delays, exponential backoff
 */

const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const RATE_LIMIT_FILE = path.join(__dirname, '../data/rate-limit.json');

// Configuration
const DAILY_VIEW_LIMIT = parseInt(process.env.DAILY_VIEW_LIMIT || '40'); // Free account limit
const MIN_DELAY = parseInt(process.env.MIN_DELAY || '3000'); // 3 seconds
const MAX_DELAY = parseInt(process.env.MAX_DELAY || '8000'); // 8 seconds
const BACKOFF_BASE = parseInt(process.env.BACKOFF_BASE || '30'); // 30 minutes base backoff
const BACKOFF_MULTIPLIER = parseFloat(process.env.BACKOFF_MULTIPLIER || '2.0');

// Rate limit state
let rateLimitState = {
  date: null,
  viewCount: 0,
  lastReset: null,
  backoffUntil: null,
  errors: {
    '429': 0,
    '403': 0,
    network: 0,
  },
};

/**
 * Load rate limit state from file
 */
const loadRateLimitState = async () => {
  try {
    const data = await fs.readFile(RATE_LIMIT_FILE, 'utf8');
    const state = JSON.parse(data);
    
    // Check if we need to reset (new day)
    const today = new Date().toISOString().split('T')[0];
    if (state.date !== today) {
      // Reset for new day
      rateLimitState = {
        date: today,
        viewCount: 0,
        lastReset: new Date().toISOString(),
        backoffUntil: null,
        errors: {
          '429': 0,
          '403': 0,
          network: 0,
        },
      };
      await saveRateLimitState();
      return rateLimitState;
    }
    
    // Check if backoff period has passed
    if (state.backoffUntil) {
      const backoffTime = new Date(state.backoffUntil);
      if (new Date() > backoffTime) {
        state.backoffUntil = null;
        await saveRateLimitState();
      } else {
        const remaining = Math.ceil((backoffTime - new Date()) / 1000 / 60);
        console.log(`⏳ Rate limit backoff active. Resuming in ${remaining} minutes`);
      }
    }
    
    rateLimitState = state;
    return rateLimitState;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, create initial state
      const today = new Date().toISOString().split('T')[0];
      rateLimitState = {
        date: today,
        viewCount: 0,
        lastReset: new Date().toISOString(),
        backoffUntil: null,
        errors: {
          '429': 0,
          '403': 0,
          network: 0,
        },
      };
      await saveRateLimitState();
      return rateLimitState;
    }
    console.error('Error loading rate limit state:', error.message);
    return rateLimitState;
  }
};

/**
 * Save rate limit state to file
 */
const saveRateLimitState = async () => {
  try {
    const dataDir = path.dirname(RATE_LIMIT_FILE);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(rateLimitState, null, 2));
  } catch (error) {
    console.error('Error saving rate limit state:', error.message);
  }
};

/**
 * Check if we can make a request
 */
const canMakeRequest = async () => {
  await loadRateLimitState();
  
  // Check if we're in backoff period
  if (rateLimitState.backoffUntil) {
    const backoffTime = new Date(rateLimitState.backoffUntil);
    if (new Date() < backoffTime) {
      const remaining = Math.ceil((backoffTime - new Date()) / 1000 / 60);
      return {
        allowed: false,
        reason: 'backoff',
        remainingMinutes: remaining,
        message: `Rate limit backoff active. Resuming in ${remaining} minutes`,
      };
    }
    // Backoff period passed, clear it
    rateLimitState.backoffUntil = null;
    await saveRateLimitState();
  }
  
  // Check daily limit
  if (rateLimitState.viewCount >= DAILY_VIEW_LIMIT) {
    return {
      allowed: false,
      reason: 'daily_limit',
      viewCount: rateLimitState.viewCount,
      limit: DAILY_VIEW_LIMIT,
      message: `Daily view limit reached (${rateLimitState.viewCount}/${DAILY_VIEW_LIMIT})`,
    };
  }
  
  return { allowed: true };
};

/**
 * Record a view/request
 */
const recordView = async () => {
  await loadRateLimitState();
  rateLimitState.viewCount++;
  await saveRateLimitState();
  
  const remaining = DAILY_VIEW_LIMIT - rateLimitState.viewCount;
  if (remaining <= 5) {
    console.warn(`⚠️  Daily limit approaching: ${rateLimitState.viewCount}/${DAILY_VIEW_LIMIT} views used`);
  }
  
  return {
    viewCount: rateLimitState.viewCount,
    remaining: remaining,
    limit: DAILY_VIEW_LIMIT,
  };
};

/**
 * Get random delay between requests
 */
const getRandomDelay = () => {
  return Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
};

/**
 * Handle rate limit error (429)
 */
const handleRateLimitError = async (errorType = '429') => {
  await loadRateLimitState();
  
  rateLimitState.errors[errorType] = (rateLimitState.errors[errorType] || 0) + 1;
  
  // Calculate exponential backoff
  const backoffMinutes = BACKOFF_BASE * Math.pow(BACKOFF_MULTIPLIER, rateLimitState.errors[errorType] - 1);
  const backoffUntil = new Date(Date.now() + backoffMinutes * 60 * 1000);
  
  rateLimitState.backoffUntil = backoffUntil.toISOString();
  await saveRateLimitState();
  
  console.error(`❌ ${errorType} error detected. Backing off for ${backoffMinutes} minutes`);
  console.error(`   Resuming at: ${backoffUntil.toLocaleString()}`);
  
  return {
    backoffMinutes,
    backoffUntil: backoffUntil.toISOString(),
    resumeAt: backoffUntil,
  };
};

/**
 * Handle 403 Forbidden (account restricted)
 */
const handleForbiddenError = async () => {
  await loadRateLimitState();
  rateLimitState.errors['403'] = (rateLimitState.errors['403'] || 0) + 1;
  await saveRateLimitState();
  
  console.error('❌ 403 Forbidden - Account may be restricted');
  console.error('   Action required: STOP scraping and appeal to LinkedIn');
  
  return {
    critical: true,
    message: 'Account restricted. Manual intervention required.',
  };
};

/**
 * Reset daily counter (for testing or manual override)
 */
const resetDailyLimit = async () => {
  const today = new Date().toISOString().split('T')[0];
  rateLimitState = {
    date: today,
    viewCount: 0,
    lastReset: new Date().toISOString(),
    backoffUntil: null,
    errors: {
      '429': 0,
      '403': 0,
      network: 0,
    },
  };
  await saveRateLimitState();
  console.log('✓ Daily limit reset');
};

/**
 * Get current rate limit status
 */
const getStatus = async () => {
  await loadRateLimitState();
  return {
    date: rateLimitState.date,
    viewCount: rateLimitState.viewCount,
    limit: DAILY_VIEW_LIMIT,
    remaining: DAILY_VIEW_LIMIT - rateLimitState.viewCount,
    backoffUntil: rateLimitState.backoffUntil,
    errors: rateLimitState.errors,
    lastReset: rateLimitState.lastReset,
  };
};

// Initialize on module load
loadRateLimitState().catch(console.error);

module.exports = {
  canMakeRequest,
  recordView,
  getRandomDelay,
  handleRateLimitError,
  handleForbiddenError,
  resetDailyLimit,
  getStatus,
  DAILY_VIEW_LIMIT,
  MIN_DELAY,
  MAX_DELAY,
};


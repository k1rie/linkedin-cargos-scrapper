# LinkedIn Cookie-Based Scraper

A secure, production-ready LinkedIn scraper that uses encrypted session cookies instead of credentials. No passwords, no 2FA automation, just encrypted `li_at` cookies.

## 🔐 Security Features

- **AES-256-CBC encryption** for cookie storage
- **No credential storage** - uses encrypted cookies only
- **Scrypt key derivation** for encryption keys
- **Sensitive data filtering** in logs
- **Secure file permissions** (600) for encrypted cookies

## 📋 Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0
- Playwright (installed automatically)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
npx playwright install chromium
```

### 2. Generate Master Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated key.

### 3. Configure Environment

Create `.env` file in `backend/` directory:

```env
MASTER_KEY=your-generated-key-here
NODE_ENV=production
LOG_LEVEL=info
DAILY_LIMIT=40
MIN_DELAY=3000
MAX_DELAY=8000
```

### 4. Extract LinkedIn Cookie

#### Method 1: Browser DevTools

1. Open LinkedIn in your browser and **log in**
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Click on **Cookies** > `https://www.linkedin.com`
5. Find the **`li_at`** cookie
6. Copy the **Value** field (it's a long string)

#### Method 2: Browser Extension

Use a cookie export extension to export all cookies, then find `li_at`.

### 5. Initialize Cookie Encryption

```bash
node src/main.js --init
```

Paste your `li_at` cookie value when prompted. The cookie will be encrypted and saved to `data/cookies.enc`.

### 6. Validate Cookie

```bash
node src/main.js --validate
```

This checks if your cookie is still valid and shows expiration info.

### 7. Scrape Profiles

```bash
node src/main.js --scrape \
  https://www.linkedin.com/in/profile1 \
  https://www.linkedin.com/in/profile2 \
  https://www.linkedin.com/in/profile3
```

## 📖 Usage

### Initialize Cookie (One-Time Setup)

```bash
node src/main.js --init
# or
node src/main.js -i
```

Prompts you to paste the `li_at` cookie value from your browser.

### Validate Cookie

```bash
node src/main.js --validate
# or
node src/main.js -v
```

Checks if the encrypted cookie is still valid by attempting to access LinkedIn feed.

### Scrape Profiles

```bash
node src/main.js --scrape <url1> <url2> <url3> ...
# or
node src/main.js -s <url1> <url2> <url3> ...
```

Scrapes the provided LinkedIn profile URLs and outputs JSON results.

### Show Statistics

```bash
node src/main.js --stats
```

Shows cookie information, daily limits, and configuration.

### Help

```bash
node src/main.js --help
# or
node src/main.js -h
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MASTER_KEY` | Encryption key (min 32 chars) | - | ✅ Yes |
| `NODE_ENV` | Environment (production/development) | `development` | No |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | `info` | No |
| `DAILY_LIMIT` | Max profiles per day | `40` | No |
| `MIN_DELAY` | Minimum delay between requests (ms) | `3000` | No |
| `MAX_DELAY` | Maximum delay between requests (ms) | `8000` | No |
| `HEADLESS` | Run browser in headless mode | `true` | No |
| `VIEWPORT_WIDTH` | Browser viewport width | `1920` | No |
| `VIEWPORT_HEIGHT` | Browser viewport height | `1080` | No |
| `MAX_RETRIES` | Max retry attempts on error | `3` | No |
| `RETRY_DELAY` | Delay between retries (ms) | `5000` | No |

### Rate Limiting

The scraper automatically:
- Tracks daily view count (resets at midnight UTC)
- Stops when daily limit is reached
- Uses random delays between requests (3-8 seconds)
- Implements exponential backoff on 429 errors

## 🔒 Security

### Encryption Details

- **Algorithm**: AES-256-CBC
- **Key Derivation**: scrypt (salt: "linkedin-scraper-salt")
- **IV**: Random 16 bytes (prepended to ciphertext)
- **Format**: `iv_hex:ciphertext_hex`

### Security Best Practices

1. **Never commit** `.env` or `cookies.enc` to git
2. **Use strong master key** (32+ characters, random)
3. **Restrict file permissions** (cookies.enc is automatically set to 600)
4. **Rotate cookies** every 7-10 days
5. **Monitor logs** for suspicious activity

### What's Logged

- ✅ Request URLs (sanitized)
- ✅ HTTP status codes
- ✅ Request counts
- ✅ Error messages
- ❌ Cookie values (never logged)
- ❌ Master keys (never logged)
- ❌ Sensitive query parameters (filtered)

## 🛡️ Error Handling

### 403 Forbidden

**Cause**: Cookie expired or account restricted

**Action**: 
1. Extract new `li_at` cookie from browser
2. Run `node src/main.js --init` to encrypt new cookie

### 429 Too Many Requests

**Cause**: Rate limit exceeded

**Action**: 
- Scraper automatically waits 30+ minutes
- Exponential backoff implemented
- Resume scraping after backoff period

### Network Timeout

**Cause**: Slow network or LinkedIn server issues

**Action**: 
- Automatic retry (up to 3 times)
- Exponential backoff between retries

### Invalid Cookie

**Cause**: Cookie decryption failed or file missing

**Action**: 
- Run `node src/main.js --init` to set up cookie
- Verify `MASTER_KEY` is correct

## 📊 Output Format

### Successful Scrape

```json
{
  "name": "John Doe",
  "jobTitle": "Software Engineer",
  "worksFor": "Tech Company",
  "address": "San Francisco, CA",
  "url": "https://www.linkedin.com/in/johndoe",
  "image": "https://...",
  "source": "json-ld",
  "url": "https://www.linkedin.com/in/johndoe"
}
```

### Failed Scrape

```json
{
  "url": "https://www.linkedin.com/in/profile",
  "error": "Error message here"
}
```

## 🎯 Browser Stealth

The scraper includes multiple stealth features:

- ✅ `navigator.webdriver` = undefined
- ✅ WebGL vendor/renderer spoofing
- ✅ Random User-Agent rotation
- ✅ Plugin array spoofing
- ✅ Language spoofing
- ✅ Random viewport sizes
- ✅ Realistic browser headers

## 📁 Project Structure

```
backend/
├── src/
│   ├── cookie-manager.js    # Cookie encryption/decryption
│   ├── linkedin-scraper.js  # Main scraping logic
│   ├── logger.js            # Winston logging
│   ├── config.js             # Configuration loader
│   ├── main.js               # CLI entry point
│   └── README.md             # This file
├── data/
│   └── cookies.enc          # Encrypted cookie (gitignored)
├── logs/
│   ├── scraper.log          # All logs
│   └── error.log             # Error logs only
├── .env                      # Environment variables (gitignored)
├── .env.example             # Environment template
└── package.json
```

## 🔄 Cookie Refresh

LinkedIn cookies typically expire after 7-10 days. To refresh:

1. Log into LinkedIn in your browser
2. Extract new `li_at` cookie (see step 4 in Quick Start)
3. Run `node src/main.js --init`
4. Paste the new cookie value

## 📝 Logging

Logs are written to:
- **Console**: Colored, formatted output
- **logs/scraper.log**: All logs (JSON format)
- **logs/error.log**: Errors only (JSON format)

Log rotation: 10MB max file size, 5 files retained.

## ⚠️ Important Notes

1. **Respect Rate Limits**: Don't exceed 40 profiles/day on free accounts
2. **Cookie Expiration**: Refresh cookies every 7-10 days
3. **Legal Compliance**: Ensure your scraping complies with LinkedIn's Terms of Service
4. **Account Safety**: Using cookies is safer than credentials, but still be cautious

## 🐛 Troubleshooting

### "MASTER_KEY is required"

Set `MASTER_KEY` in `.env` file. Generate one with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### "Encrypted cookie file not found"

Run `node src/main.js --init` to encrypt and save a cookie.

### "Cookie validation failed"

Your cookie may be expired. Extract a new one and run `--init` again.

### "Daily limit reached"

Wait until midnight UTC or increase `DAILY_LIMIT` in `.env`.

## 📄 License

ISC

## 🤝 Contributing

This is a production-ready scraper. Ensure all security practices are followed when making changes.

---

**Built with security and reliability in mind** 🔒


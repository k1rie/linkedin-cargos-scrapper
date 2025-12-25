const linkedinService = require('../services/linkedinService');

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await linkedinService.login(email, password);
    
    if (result.success) {
      res.json({ message: 'Login successful', cookies: result.cookies });
    } else {
      res.status(401).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const checkSession = async (req, res) => {
  try {
    const isLoggedIn = await linkedinService.checkSession();
    res.json({ isLoggedIn });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const autoLogin = async (req, res) => {
  try {
    const result = await linkedinService.attemptAutoLogin();
    
    if (result.success) {
      res.json({ message: 'Auto-login successful', cookies: result.cookies });
    } else {
      res.status(401).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  login,
  checkSession,
  autoLogin
};


const linkedinService = require('../services/linkedinService');

const checkSession = async (req, res) => {
  try {
    const isLoggedIn = await linkedinService.checkSession();
    res.json({ isLoggedIn });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const uploadCookies = async (req, res) => {
  try {
    const { cookies } = req.body;
    
    if (!cookies || !Array.isArray(cookies)) {
      return res.status(400).json({ error: 'Cookies array is required' });
    }

    const result = await linkedinService.saveCookiesFromUser(cookies);
    
    if (result.success) {
      res.json({ message: 'Cookies saved successfully. You can now start scraping.' });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  checkSession,
  uploadCookies
};


const linkedinService = require('../services/linkedinService');

const verifyCode = async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const result = await linkedinService.verifyCode(code);
    
    if (result.success) {
      res.json({ message: 'Verification successful. Scraping can continue.' });
    } else {
      res.status(401).json({ error: result.error || 'Verification failed' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  verifyCode
};

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/upload-cookies', authController.uploadCookies);
router.get('/check-session', authController.checkSession);

module.exports = router;


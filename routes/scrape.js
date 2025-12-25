const express = require('express');
const router = express.Router();
const scrapeController = require('../controllers/scrapeController');

router.post('/start', scrapeController.startScraping);
router.get('/status', scrapeController.getStatus);

module.exports = router;


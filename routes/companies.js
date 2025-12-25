const express = require('express');
const router = express.Router();
const companiesController = require('../controllers/companiesController');

router.get('/', companiesController.getCompanies);
router.get('/:id', companiesController.getCompanyById);
router.put('/:id/last-scrape', companiesController.updateLastScrape);

module.exports = router;


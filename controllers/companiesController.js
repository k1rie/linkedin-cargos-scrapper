const hubspotService = require('../services/hubspotService');

const getCompanies = async (req, res) => {
  try {
    const companies = await hubspotService.getCompaniesFromSegment();
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await hubspotService.getCompanyById(id);
    res.json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateLastScrape = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.body;
    const result = await hubspotService.updateLastScrape(id, date);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getCompanies,
  getCompanyById,
  updateLastScrape
};


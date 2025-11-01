const express = require('express');
const { z } = require('zod');
const importer = require('../services/importer');
const validate = require('../middleware/validate');

const importSchema = z.object({}).passthrough();

const router = express.Router();

router.post('/', validate(importSchema), async (req, res, next) => {
  try {
    const payload = req.body || {};
    await importer.importData(payload);
    res.status(202).json({ status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

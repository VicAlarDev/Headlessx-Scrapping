/**
 * E-Commerce Routes v1.0.0
 * Routes for product scraping from Amazon, eBay, Walmart, AliExpress, MercadoLibre, etc.
 */

const express = require('express');
const router = express.Router();

const EcommerceController = require('../controllers/ecommerce');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');

// Main product scraping endpoint - returns full data (products, prompt, html)
router.post('/products', authenticate, asyncHandler(EcommerceController.scrapeProducts));

// Get only AI-ready text prompt
router.post('/products/prompt', authenticate, asyncHandler(EcommerceController.getProductsPrompt));

// Get only minimal HTML for AI processing
router.post('/products/html', authenticate, asyncHandler(EcommerceController.getProductsHtml));

// Get only products as JSON array
router.post('/products/json', authenticate, asyncHandler(EcommerceController.getProductsJson));

module.exports = router;

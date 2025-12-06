/**
 * Amazon Routes v1.0.0
 * Routes for Amazon-specific scraping endpoints
 */

const express = require('express');
const router = express.Router();

const AmazonController = require('../../controllers/stores/amazon');
const { authenticate } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error');

// Product list scraping (search results page)
router.post('/products', authenticate, asyncHandler(AmazonController.scrapeProductList));

// Single product detail page
router.post('/product', authenticate, asyncHandler(AmazonController.scrapeProductDetail));

// Get only products as JSON (simplified)
router.post('/products/json', authenticate, asyncHandler(AmazonController.getProductsJson));

// Get raw search results HTML
router.post('/products/html', authenticate, asyncHandler(AmazonController.getProductsHtml));

// Check AI status
router.get('/ai-status', authenticate, asyncHandler(AmazonController.getAIStatus));

module.exports = router;

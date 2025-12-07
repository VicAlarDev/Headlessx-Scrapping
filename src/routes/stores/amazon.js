/**
 * Amazon Routes v1.1.0
 * Routes for Amazon-specific scraping endpoints with caching
 */

const express = require('express');
const router = express.Router();

const AmazonController = require('../../controllers/stores/amazon');
const { authenticate, authenticateApiKey } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/error');

// Product list scraping (search results page)
// Supports both legacy token and API key auth
router.post('/products', authenticate, asyncHandler(AmazonController.scrapeProductList));

// Single product detail page
router.post('/product', authenticate, asyncHandler(AmazonController.scrapeProductDetail));

// Get product price history by ASIN
router.get('/product/:asin/history', authenticate, asyncHandler(AmazonController.getProductHistory));

// Get only products as JSON (simplified)
router.post('/products/json', authenticate, asyncHandler(AmazonController.getProductsJson));

// Get raw search results HTML
router.post('/products/html', authenticate, asyncHandler(AmazonController.getProductsHtml));

// Check AI status
router.get('/ai-status', authenticate, asyncHandler(AmazonController.getAIStatus));

module.exports = router;

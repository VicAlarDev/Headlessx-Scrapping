/**
 * Amazon Controller v1.0.0
 * Handles Amazon-specific scraping endpoints
 */

const AmazonScraperService = require('../../services/stores/amazon');
const GeminiService = require('../../services/gemini');
const { validateUrl } = require('../../utils/helpers');
const { logger } = require('../../utils/logger');
const { sendSecureResponse } = require('../../utils/security');
const { createErrorResponse } = require('../../utils/errors');

class AmazonController {
    /**
     * Scrape Amazon product list (search results)
     * POST /api/amazon/products
     */
    static async scrapeProductList(req, res) {
        const requestId = req.requestId;

        try {
            const { url } = req.body;
            const validation = validateUrl(url);

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            // Validate it's an Amazon URL
            if (!url.includes('amazon.')) {
                return res.status(400).json({
                    success: false,
                    error: 'URL must be an Amazon domain (amazon.com, amazon.es, etc.)'
                });
            }

            logger.info(requestId, `Amazon product list scrape: ${url}`);

            const options = {
                useAI: req.body.useAI !== false,
                maxProducts: req.body.maxProducts || 50,
                timeout: req.body.timeout || 90000,
                language: req.body.language || 'es',
                includeImages: req.body.includeImages !== false,
                includeRawHtml: req.body.includeRawHtml === true,
                page: req.body.page || null // Page number to scrape
            };

            const result = await AmazonScraperService.scrapeProductList(url, options);

            logger.info(requestId, `Scraped ${result.productCount} products from Amazon (page ${result.pagination?.currentPage || 1})`);

            res.json(result);
        } catch (error) {
            logger.error(requestId, 'Amazon product list scrape error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Scrape single Amazon product detail page
     * POST /api/amazon/product
     */
    static async scrapeProductDetail(req, res) {
        const requestId = req.requestId;

        try {
            const { url } = req.body;
            const validation = validateUrl(url);

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            if (!url.includes('amazon.')) {
                return res.status(400).json({
                    success: false,
                    error: 'URL must be an Amazon domain'
                });
            }

            logger.info(requestId, `Amazon product detail scrape: ${url}`);

            const options = {
                useAI: req.body.useAI !== false,
                timeout: req.body.timeout || 60000,
                language: req.body.language || 'es'
            };

            const result = await AmazonScraperService.scrapeProductDetail(url, options);

            logger.info(requestId, 'Amazon product detail scraped successfully');

            res.json(result);
        } catch (error) {
            logger.error(requestId, 'Amazon product detail scrape error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get only products as JSON (simplified response)
     * POST /api/amazon/products/json
     */
    static async getProductsJson(req, res) {
        const requestId = req.requestId;

        try {
            const { url } = req.body;
            const validation = validateUrl(url);

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            if (!url.includes('amazon.')) {
                return res.status(400).json({
                    success: false,
                    error: 'URL must be an Amazon domain'
                });
            }

            logger.info(requestId, `Amazon products JSON: ${url}`);

            const options = {
                useAI: req.body.useAI !== false,
                maxProducts: req.body.maxProducts || 50,
                timeout: req.body.timeout || 90000,
                language: req.body.language || 'es',
                includeImages: req.body.includeImages !== false,
                page: req.body.page || null
            };

            const result = await AmazonScraperService.scrapeProductList(url, options);

            // Return simplified JSON with pagination
            res.json({
                success: true,
                productCount: result.productCount,
                products: result.products,
                pagination: result.pagination,
                extraction: result.extraction,
                timestamp: result.metadata.timestamp
            });
        } catch (error) {
            logger.error(requestId, 'Amazon products JSON error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get raw search results HTML (for custom processing)
     * POST /api/amazon/products/html
     */
    static async getProductsHtml(req, res) {
        const requestId = req.requestId;

        try {
            const { url } = req.body;
            const validation = validateUrl(url);

            if (!validation.valid) {
                return res.status(400).send(validation.error);
            }

            if (!url.includes('amazon.')) {
                return res.status(400).send('URL must be an Amazon domain');
            }

            logger.info(requestId, `Amazon products HTML: ${url}`);

            const options = {
                useAI: false, // Don't need AI for raw HTML
                timeout: req.body.timeout || 90000,
                includeRawHtml: true
            };

            const result = await AmazonScraperService.scrapeProductList(url, options);

            const customHeaders = {
                'X-Product-Count': result.productCount.toString(),
                'X-Original-Length': result.metadata.originalHtmlLength.toString(),
                'X-Extracted-Length': result.metadata.searchResultsHtmlLength.toString(),
                'X-Compression-Ratio': result.metadata.compressionRatio,
                'X-Timestamp': result.metadata.timestamp
            };

            sendSecureResponse(res, result.rawSearchResultsHtml, 'text/html; charset=utf-8', customHeaders);
        } catch (error) {
            logger.error(requestId, 'Amazon products HTML error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Check Gemini AI status
     * GET /api/amazon/ai-status
     */
    static async getAIStatus(req, res) {
        const requestId = req.requestId;

        try {
            const status = GeminiService.getStatus();

            res.json({
                success: true,
                gemini: status,
                message: status.configured
                    ? 'Gemini AI is configured and ready'
                    : 'Gemini AI is not configured. Add GEMINI_API_KEY to your .env file.'
            });
        } catch (error) {
            logger.error(requestId, 'AI status check error', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = AmazonController;

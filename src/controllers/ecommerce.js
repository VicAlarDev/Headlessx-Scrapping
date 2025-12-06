/**
 * E-Commerce Controller v1.0.0
 * Handles product scraping for Amazon, eBay, Walmart, AliExpress, MercadoLibre, etc.
 * Optimized for AI processing (Gemini, GPT, Claude)
 */

const ProductExtractorService = require('../services/product-extractor');
const { validateUrl } = require('../utils/helpers');
const { logger } = require('../utils/logger');
const { sendSecureResponse } = require('../utils/security');
const { createErrorResponse } = require('../utils/errors');

class EcommerceController {
    /**
     * Scrape product list from any e-commerce site
     * POST /api/ecommerce/products
     */
    static async scrapeProducts(req, res) {
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

            logger.info(requestId, `E-commerce product scrape request: ${url}`);

            const options = {
                site: req.body.site, // Optional: force site type
                maxProducts: req.body.maxProducts || 50,
                includeImages: req.body.includeImages !== false,
                includeLinks: req.body.includeLinks !== false,
                includePrices: req.body.includePrices !== false,
                includeReviews: req.body.includeReviews !== false,
                timeout: req.body.timeout || 60000,
                format: req.body.format || 'json',
                language: req.body.language || 'es',
                renderOptions: req.body.renderOptions || {}
            };

            const result = await ProductExtractorService.scrapeProductList(url, options);

            logger.info(requestId, `Scraped ${result.productCount} products from ${result.site}`);

            res.json(result);
        } catch (error) {
            logger.error(requestId, 'E-commerce scrape error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get only the AI-ready prompt (text format for direct AI input)
     * POST /api/ecommerce/products/prompt
     */
    static async getProductsPrompt(req, res) {
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

            logger.info(requestId, `AI prompt generation request: ${url}`);

            const options = {
                site: req.body.site,
                maxProducts: req.body.maxProducts || 50,
                includeImages: req.body.includeImages !== false,
                includeLinks: req.body.includeLinks !== false,
                includePrices: req.body.includePrices !== false,
                includeReviews: req.body.includeReviews !== false,
                timeout: req.body.timeout || 60000,
                language: req.body.language || 'es'
            };

            const result = await ProductExtractorService.scrapeProductList(url, options);

            logger.info(requestId, `Generated AI prompt for ${result.productCount} products`);

            // Return plain text prompt
            const customHeaders = {
                'X-Product-Count': result.productCount.toString(),
                'X-Site': result.site,
                'X-Timestamp': result.metadata.timestamp
            };

            sendSecureResponse(res, result.aiPrompt, 'text/plain; charset=utf-8', customHeaders);
        } catch (error) {
            logger.error(requestId, 'AI prompt generation error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get minimal HTML optimized for AI processing
     * POST /api/ecommerce/products/html
     */
    static async getProductsHtml(req, res) {
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

            logger.info(requestId, `Minimal HTML generation request: ${url}`);

            const options = {
                site: req.body.site,
                maxProducts: req.body.maxProducts || 50,
                includeImages: req.body.includeImages !== false,
                includeLinks: req.body.includeLinks !== false,
                includePrices: req.body.includePrices !== false,
                includeReviews: req.body.includeReviews !== false,
                timeout: req.body.timeout || 60000
            };

            const result = await ProductExtractorService.scrapeProductList(url, options);

            logger.info(requestId, `Generated minimal HTML for ${result.productCount} products`);

            const customHeaders = {
                'X-Product-Count': result.productCount.toString(),
                'X-Site': result.site,
                'X-Original-Length': result.metadata.originalHtmlLength.toString(),
                'X-Minimal-Length': result.metadata.minimalHtmlLength.toString(),
                'X-Compression-Ratio': result.metadata.compressionRatio,
                'X-Timestamp': result.metadata.timestamp
            };

            sendSecureResponse(res, result.aiReadyHtml, 'text/html; charset=utf-8', customHeaders);
        } catch (error) {
            logger.error(requestId, 'Minimal HTML generation error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get only the extracted products as JSON (no HTML, no prompt)
     * POST /api/ecommerce/products/json
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

            logger.info(requestId, `JSON products extraction request: ${url}`);

            const options = {
                site: req.body.site,
                maxProducts: req.body.maxProducts || 50,
                includeImages: req.body.includeImages !== false,
                includeLinks: req.body.includeLinks !== false,
                includePrices: req.body.includePrices !== false,
                includeReviews: req.body.includeReviews !== false,
                timeout: req.body.timeout || 60000
            };

            const result = await ProductExtractorService.scrapeProductList(url, options);

            logger.info(requestId, `Extracted ${result.productCount} products as JSON`);

            res.json({
                success: true,
                site: result.site,
                url: result.url,
                productCount: result.productCount,
                products: result.products,
                metadata: result.metadata
            });
        } catch (error) {
            logger.error(requestId, 'JSON products extraction error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }
}

module.exports = EcommerceController;

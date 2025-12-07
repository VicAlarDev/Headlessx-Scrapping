/**
 * Amazon Controller v1.1.0
 * Handles Amazon-specific scraping endpoints with caching
 */

const AmazonScraperService = require('../../services/stores/amazon');
const GeminiService = require('../../services/gemini');
const ProductCacheService = require('../../services/productCache');
const { validateUrl } = require('../../utils/helpers');
const { logger } = require('../../utils/logger');
const { sendSecureResponse } = require('../../utils/security');
const { createErrorResponse } = require('../../utils/errors');

class AmazonController {
    /**
     * Scrape Amazon product list (search results)
     * POST /api/amazon/products
     *
     * Features:
     * - 24-hour cache validation
     * - Cross-user cache sharing
     * - Force refresh option
     */
    static async scrapeProductList(req, res) {
        const requestId = req.requestId;

        try {
            const { url } = req.body;
            const forceRefresh = req.body.forceRefresh === true;
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

            // Check cache first (unless force refresh)
            if (!forceRefresh) {
                try {
                    const cached = await ProductCacheService.getCachedSearchResults(url);
                    if (cached) {
                        logger.info(requestId, `Returning cached results (${cached.productCount} products)`);
                        return res.json({
                            success: true,
                            cached: true,
                            cachedAt: cached.cachedAt,
                            expiresAt: cached.expiresAt,
                            url,
                            site: 'amazon',
                            products: cached.products,
                            productCount: cached.productCount,
                            extraction: { method: 'cache' },
                            metadata: {
                                timestamp: new Date().toISOString(),
                                cacheHit: true
                            }
                        });
                    }
                } catch (cacheError) {
                    logger.warn(requestId, 'Cache lookup failed, proceeding with scrape', {
                        error: cacheError.message
                    });
                }
            }

            const options = {
                useAI: req.body.useAI !== false,
                maxProducts: req.body.maxProducts || 50,
                timeout: req.body.timeout || 90000,
                language: req.body.language || 'es',
                includeImages: req.body.includeImages !== false,
                includeRawHtml: req.body.includeRawHtml === true,
                page: req.body.page || null
            };

            const result = await AmazonScraperService.scrapeProductList(url, options);

            logger.info(requestId, `Scraped ${result.productCount} products from Amazon (page ${result.pagination?.currentPage || 1})`);

            // Detect store from URL and save to cache
            let storeInfo = null;
            try {
                storeInfo = await ProductCacheService.getStoreByUrl(url);
                const userId = req.user?.id || null;

                await ProductCacheService.saveSearchResults(
                    url,
                    req.body.searchTerm || null,
                    result.products,
                    userId,
                    storeInfo?.id || 1
                );
            } catch (cacheError) {
                logger.warn(requestId, 'Failed to save to cache', { error: cacheError.message });
            }

            // Build store info for response
            let storeResponse = null;
            if (storeInfo) {
                storeResponse = {
                    name: storeInfo.name,
                    countryCode: storeInfo.country_code,
                    domain: storeInfo.detected?.domain
                };
            }

            res.json({
                ...result,
                cached: false,
                store: storeResponse
            });
        } catch (error) {
            logger.error(requestId, 'Amazon product list scrape error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Scrape single Amazon product detail page
     * POST /api/amazon/product
     *
     * Features:
     * - 24-hour cache validation
     * - Price history tracking
     * - Cross-user cache sharing
     */
    static async scrapeProductDetail(req, res) {
        const requestId = req.requestId;

        try {
            const { url } = req.body;
            const forceRefresh = req.body.forceRefresh === true;
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

            // Check cache first (unless force refresh)
            if (!forceRefresh) {
                try {
                    const cached = await ProductCacheService.getCachedProduct(url);
                    if (cached) {
                        logger.info(requestId, `Returning cached product: ${cached.product.asin}`);

                        // Get price history for comparison
                        let priceHistory = [];
                        try {
                            priceHistory = await ProductCacheService.getProductPriceHistory(
                                cached.product.id,
                                30
                            );
                        } catch (e) {
                            // Ignore history errors
                        }

                        return res.json({
                            success: true,
                            cached: true,
                            cachedAt: cached.lastScrapedAt,
                            url,
                            product: cached.product,
                            priceHistory: priceHistory.slice(0, 10),
                            extraction: { method: 'cache' },
                            metadata: {
                                timestamp: new Date().toISOString(),
                                cacheHit: true,
                                storeName: cached.storeName
                            }
                        });
                    }
                } catch (cacheError) {
                    logger.warn(requestId, 'Cache lookup failed, proceeding with scrape', {
                        error: cacheError.message
                    });
                }
            }

            const options = {
                useAI: req.body.useAI !== false,
                timeout: req.body.timeout || 60000,
                language: req.body.language || 'es'
            };

            const result = await AmazonScraperService.scrapeProductDetail(url, options);

            logger.info(requestId, `Amazon product scraped: ${result.product?.asin || 'unknown'} (condition: ${result.product?.condition || 'new'})`);

            // Detect store from URL and save to cache
            let storeInfo = null;
            if (result.product?.asin) {
                try {
                    storeInfo = await ProductCacheService.getStoreByUrl(url);
                    const userId = req.user?.id || null;

                    await ProductCacheService.saveProduct(
                        url,
                        result.product,
                        userId,
                        storeInfo?.id || 1
                    );
                } catch (cacheError) {
                    logger.warn(requestId, 'Failed to save to cache', { error: cacheError.message });
                }
            }

            // Build store info for response
            let storeResponse = null;
            if (storeInfo) {
                storeResponse = {
                    name: storeInfo.name,
                    countryCode: storeInfo.country_code,
                    domain: storeInfo.detected?.domain
                };
            }

            res.json({
                ...result,
                cached: false,
                store: storeResponse
            });
        } catch (error) {
            logger.error(requestId, 'Amazon product detail scrape error', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.body?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get product price history
     * GET /api/amazon/product/:asin/history
     */
    static async getProductHistory(req, res) {
        const requestId = req.requestId;

        try {
            const { asin } = req.params;
            const days = parseInt(req.query.days || '30', 10);

            if (!asin) {
                return res.status(400).json({
                    success: false,
                    error: 'ASIN is required'
                });
            }

            logger.info(requestId, `Getting price history for ASIN: ${asin}`);

            // Get product by ASIN across all stores
            const products = await ProductCacheService.getProductByAsin(asin);

            if (products.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }

            // Get price history for each store
            const result = await Promise.all(products.map(async(product) => {
                const history = await ProductCacheService.getProductPriceHistory(product.id, days);
                return {
                    store: product.store_name,
                    storeUrl: product.store_url,
                    productUrl: product.product_url,
                    name: product.name,
                    currentPrice: parseFloat(product.price) || null,
                    currency: product.currency,
                    priceHistory: history
                };
            }));

            res.json({
                success: true,
                asin,
                stores: result,
                metadata: {
                    timestamp: new Date().toISOString(),
                    daysRequested: days
                }
            });
        } catch (error) {
            logger.error(requestId, 'Get product history error', error);
            const { statusCode, errorResponse } = createErrorResponse(error);
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

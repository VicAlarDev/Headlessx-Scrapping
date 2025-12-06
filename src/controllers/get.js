/**
 * GET Endpoints Controller
 * Handles GET requests for HTML, content, and other endpoints
 */

const RenderingService = require('../services/rendering');
const { validateUrl, extractOptionsFromQuery, extractCleanText, extractCleanHtml } = require('../utils/helpers');
const { logger } = require('../utils/logger');
const { createErrorResponse } = require('../utils/errors');
const browserService = require('../services/browser');
const { sendSecureResponse } = require('../utils/security');

class GetController {
    // HTML endpoint (GET version - returns raw HTML directly)
    static async getHtml(req, res) {
        const requestId = req.requestId;

        try {
            // Validate URL (from query parameter for GET)
            const { url } = req.query;
            const validation = validateUrl(url);
            if (!validation.valid) {
                return res.status(400).send(validation.error);
            }

            logger.info(requestId, `Advanced HTML rendering (GET): ${url}`);

            // Extract options from query parameters
            const options = extractOptionsFromQuery(req.query);

            const result = await RenderingService.renderPageAdvanced(options);

            logger.info(requestId, `Successfully rendered HTML (GET): ${url} (${result.wasTimeout ? 'with timeouts' : 'complete'})`);

            // Return raw HTML with proper headers
            const customHeaders = {
                'X-Rendered-URL': result.url,
                'X-Page-Title': result.title,
                'X-Timestamp': result.timestamp,
                'X-Was-Timeout': result.wasTimeout.toString(),
                'X-Content-Length': result.contentLength.toString(),
                'X-Is-Emergency': (result.isEmergencyContent || false).toString()
            };
            sendSecureResponse(res, result.html, 'text/html; charset=utf-8', customHeaders);
        } catch (error) {
            logger.error(requestId, 'HTML rendering error (GET)', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.query?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    // Content endpoint (GET version - returns clean text only)
    static async getContent(req, res) {
        const requestId = req.requestId;

        try {
            // Validate URL (from query parameter for GET)
            const { url } = req.query;
            const validation = validateUrl(url);
            if (!validation.valid) {
                return res.status(400).send(validation.error);
            }

            logger.info(requestId, `Advanced content extraction (GET): ${url}`);

            // Extract options from query parameters
            const options = extractOptionsFromQuery(req.query);

            const result = await RenderingService.renderPageAdvanced(options);

            // Extract clean text content
            const textContent = await extractCleanText(result.html, browserService);

            logger.info(requestId, `Successfully extracted content (GET): ${url} (${result.wasTimeout ? 'with timeouts' : 'complete'})`);
            logger.info(requestId, `Content length: ${textContent.length} characters`);

            // Return plain text with proper headers
            const customHeaders = {
                'X-Rendered-URL': result.url,
                'X-Page-Title': result.title,
                'X-Content-Length': textContent.length,
                'X-Timestamp': result.timestamp,
                'X-Was-Timeout': result.wasTimeout.toString(),
                'X-Is-Emergency': (result.isEmergencyContent || false).toString()
            };
            sendSecureResponse(res, textContent, 'text/plain; charset=utf-8', customHeaders);
        } catch (error) {
            logger.error(requestId, 'Content extraction error (GET)', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.query?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    // Clean HTML endpoint (GET version - returns HTML without CSS but preserving links)
    static async getCleanHtml(req, res) {
        const requestId = req.requestId;

        try {
            // Validate URL (from query parameter for GET)
            const { url } = req.query;
            const validation = validateUrl(url);
            if (!validation.valid) {
                return res.status(400).send(validation.error);
            }

            logger.info(requestId, `Clean HTML rendering (GET, no CSS): ${url}`);

            // Extract options from query parameters
            const options = extractOptionsFromQuery(req.query);

            // Clean HTML options from query params
            const cleanHtmlOptions = {
                removeClasses: req.query.removeClasses === 'true',
                removeIds: req.query.removeIds === 'true',
                removeDataAttrs: req.query.removeDataAttrs !== 'false',
                preserveLinks: req.query.preserveLinks !== 'false',
                preserveImages: req.query.preserveImages !== 'false',
                preserveForms: req.query.preserveForms === 'true',
                removeScripts: req.query.removeScripts !== 'false',
                removeComments: req.query.removeComments !== 'false'
            };

            const result = await RenderingService.renderPageAdvanced(options);

            // Extract clean HTML without CSS
            const cleanHtml = await extractCleanHtml(result.html, browserService, cleanHtmlOptions);

            logger.info(requestId, `Successfully extracted clean HTML (GET): ${url} (${result.wasTimeout ? 'with timeouts' : 'complete'})`);
            logger.info(requestId, `Clean HTML length: ${cleanHtml.length} characters (original: ${result.html.length})`);

            // Return clean HTML with proper headers
            const customHeaders = {
                'X-Rendered-URL': result.url,
                'X-Page-Title': result.title,
                'X-Timestamp': result.timestamp,
                'X-Was-Timeout': result.wasTimeout.toString(),
                'X-Original-Length': result.html.length.toString(),
                'X-Clean-Length': cleanHtml.length.toString(),
                'X-Is-Emergency': (result.isEmergencyContent || false).toString()
            };
            sendSecureResponse(res, cleanHtml, 'text/html; charset=utf-8', customHeaders);
        } catch (error) {
            logger.error(requestId, 'Clean HTML rendering error (GET)', error);
            const { statusCode, errorResponse } = createErrorResponse(error, req.query?.url);
            res.status(statusCode).json(errorResponse);
        }
    }

    // API documentation endpoint
    static getApiDocs(req, res) {
        const requestId = req.requestId;

        const documentation = {
            name: 'HeadlessX API',
            version: '1.2.0',
            description: 'Advanced Browserless Web Scraping API with Human-like Behavior',
            baseUrl: `${req.protocol}://${req.get('host')}`,
            authentication: {
                type: 'Token-based',
                description: 'Include token in query parameter, X-Token header, or Authorization header',
                example: '?token=your_token_here'
            },
            endpoints: {
                health: {
                    method: 'GET',
                    path: '/api/health',
                    description: 'Server health check',
                    authentication: false,
                    response: 'JSON with server status'
                },
                status: {
                    method: 'GET',
                    path: '/api/status',
                    description: 'Detailed server status and configuration',
                    authentication: true,
                    response: 'JSON with detailed server information'
                },
                render: {
                    method: 'POST',
                    path: '/api/render',
                    description: 'Full page rendering with comprehensive options',
                    authentication: true,
                    parameters: {
                        url: 'Required. URL to render',
                        timeout: 'Optional. Timeout in milliseconds (default: 120000)',
                        waitForSelectors: 'Optional. Array of CSS selectors to wait for',
                        clickSelectors: 'Optional. Array of CSS selectors to click',
                        customScript: 'Optional. Custom JavaScript to execute',
                        returnPartialOnTimeout: 'Optional. Return partial content on timeout'
                    },
                    response: 'JSON with HTML, title, URL, and metadata'
                },
                html: {
                    methods: ['POST', 'GET'],
                    path: '/api/html',
                    description: 'Raw HTML extraction',
                    authentication: true,
                    parameters: {
                        url: 'Required. URL to render (POST: body, GET: query)',
                        timeout: 'Optional. Timeout in milliseconds',
                        returnPartialOnTimeout: 'Optional. Return partial content on timeout'
                    },
                    response: 'Raw HTML content with custom headers'
                },
                content: {
                    methods: ['POST', 'GET'],
                    path: '/api/content',
                    description: 'Clean text content extraction',
                    authentication: true,
                    parameters: {
                        url: 'Required. URL to render (POST: body, GET: query)',
                        timeout: 'Optional. Timeout in milliseconds',
                        returnPartialOnTimeout: 'Optional. Return partial content on timeout'
                    },
                    response: 'Plain text content with custom headers'
                },
                htmlClean: {
                    methods: ['POST', 'GET'],
                    path: '/api/html/clean',
                    description: 'HTML without CSS styles but preserving links and structure',
                    authentication: true,
                    parameters: {
                        url: 'Required. URL to render (POST: body, GET: query)',
                        timeout: 'Optional. Timeout in milliseconds',
                        returnPartialOnTimeout: 'Optional. Return partial content on timeout',
                        removeClasses: 'Optional. Remove class attributes (default: false)',
                        removeIds: 'Optional. Remove id attributes (default: false)',
                        removeDataAttrs: 'Optional. Remove data-* attributes (default: true)',
                        preserveLinks: 'Optional. Keep <a> tags with href (default: true)',
                        preserveImages: 'Optional. Keep <img> tags (default: true)',
                        preserveForms: 'Optional. Keep form elements (default: false)',
                        removeScripts: 'Optional. Remove <script> tags (default: true)',
                        removeComments: 'Optional. Remove HTML comments (default: true)'
                    },
                    response: 'HTML content without CSS with custom headers'
                },
                screenshot: {
                    method: 'GET',
                    path: '/api/screenshot',
                    description: 'Generate page screenshot',
                    authentication: true,
                    parameters: {
                        url: 'Required. URL to screenshot',
                        fullPage: 'Optional. Full page screenshot (true/false)',
                        format: 'Optional. Image format (png/jpeg)',
                        width: 'Optional. Viewport width',
                        height: 'Optional. Viewport height'
                    },
                    response: 'Binary image data'
                },
                pdf: {
                    method: 'GET',
                    path: '/api/pdf',
                    description: 'Generate PDF from page',
                    authentication: true,
                    parameters: {
                        url: 'Required. URL to convert to PDF',
                        format: 'Optional. Page format (A4, Letter, etc.)',
                        marginTop: 'Optional. Top margin',
                        marginRight: 'Optional. Right margin',
                        marginBottom: 'Optional. Bottom margin',
                        marginLeft: 'Optional. Left margin'
                    },
                    response: 'Binary PDF data'
                },
                batch: {
                    method: 'POST',
                    path: '/api/batch',
                    description: 'Batch processing of multiple URLs',
                    authentication: true,
                    parameters: {
                        urls: 'Required. Array of URLs to process',
                        concurrency: 'Optional. Number of concurrent requests (max 3)',
                        '...options': 'Optional. Any rendering options applied to all URLs'
                    },
                    response: 'JSON with results and errors for each URL'
                },
                ecommerceProducts: {
                    method: 'POST',
                    path: '/api/ecommerce/products',
                    description: 'Scrape product list from e-commerce sites (Amazon, eBay, Walmart, etc.)',
                    authentication: true,
                    parameters: {
                        url: 'Required. URL of product listing page',
                        site: 'Optional. Force site type (amazon, ebay, walmart, aliexpress, mercadolibre, generic)',
                        maxProducts: 'Optional. Maximum products to extract (default: 50)',
                        includeImages: 'Optional. Include image URLs (default: true)',
                        includeLinks: 'Optional. Include product URLs (default: true)',
                        includePrices: 'Optional. Include prices (default: true)',
                        includeReviews: 'Optional. Include ratings/reviews (default: true)',
                        timeout: 'Optional. Timeout in milliseconds (default: 60000)',
                        language: 'Optional. Language for AI prompt (es/en, default: es)'
                    },
                    response: 'JSON with products array, AI prompt, and minimal HTML'
                },
                ecommerceProductsPrompt: {
                    method: 'POST',
                    path: '/api/ecommerce/products/prompt',
                    description: 'Get AI-ready text prompt for product data extraction',
                    authentication: true,
                    response: 'Plain text prompt ready for Gemini/GPT/Claude'
                },
                ecommerceProductsHtml: {
                    method: 'POST',
                    path: '/api/ecommerce/products/html',
                    description: 'Get minimal HTML optimized for AI processing',
                    authentication: true,
                    response: 'Minimal HTML with only product data'
                },
                ecommerceProductsJson: {
                    method: 'POST',
                    path: '/api/ecommerce/products/json',
                    description: 'Get extracted products as JSON array',
                    authentication: true,
                    response: 'JSON with products array only'
                },
                amazonProducts: {
                    method: 'POST',
                    path: '/api/amazon/products',
                    description: 'Scrape Amazon product list with Gemini AI extraction',
                    authentication: true,
                    parameters: {
                        url: 'Required. Amazon search results URL',
                        page: 'Optional. Page number to scrape (default: 1)',
                        useAI: 'Optional. Use Gemini AI for extraction (default: true)',
                        maxProducts: 'Optional. Maximum products to extract (default: 50)',
                        timeout: 'Optional. Timeout in milliseconds (default: 90000)',
                        language: 'Optional. Language for AI (es/en, default: es)',
                        includeImages: 'Optional. Include image URLs (default: true)',
                        includeRawHtml: 'Optional. Include raw HTML in response (default: false)'
                    },
                    response: 'JSON with products, pagination info, extraction method, and metadata'
                },
                amazonProduct: {
                    method: 'POST',
                    path: '/api/amazon/product',
                    description: 'Scrape single Amazon product detail page',
                    authentication: true,
                    parameters: {
                        url: 'Required. Amazon product page URL',
                        useAI: 'Optional. Use Gemini AI (default: true)',
                        language: 'Optional. Language for AI (es/en, default: es)'
                    },
                    response: 'JSON with detailed product information'
                },
                amazonAIStatus: {
                    method: 'GET',
                    path: '/api/amazon/ai-status',
                    description: 'Check Gemini AI configuration status',
                    authentication: true,
                    response: 'JSON with AI availability status'
                }
            },
            features: [
                'Realistic Windows user agent rotation',
                'Human-like mouse movements and interactions',
                'Advanced stealth techniques to avoid bot detection',
                'Comprehensive header spoofing',
                'Natural scrolling patterns',
                'Emergency content extraction with fallback methods',
                'Multiple output formats (HTML, text, screenshots, PDFs)',
                'Batch processing with controlled concurrency',
                'Timeout handling with partial content recovery',
                'E-commerce scraping (Amazon, eBay, Walmart, AliExpress, MercadoLibre)',
                'Gemini AI integration for intelligent data extraction',
                'Store-specific optimized selectors and extraction'
            ],
            examples: {
                basicHtml: {
                    method: 'POST',
                    url: '/api/html',
                    body: {
                        url: 'https://example.com'
                    }
                },
                advancedRendering: {
                    method: 'POST',
                    url: '/api/render',
                    body: {
                        url: 'https://example.com',
                        timeout: 60000,
                        waitForSelectors: ['.content', '#main'],
                        scrollToBottom: true,
                        returnPartialOnTimeout: true
                    }
                },
                batchProcessing: {
                    method: 'POST',
                    url: '/api/batch',
                    body: {
                        urls: ['https://example1.com', 'https://example2.com'],
                        concurrency: 2,
                        timeout: 30000
                    }
                },
                amazonScraping: {
                    method: 'POST',
                    url: '/api/ecommerce/products',
                    body: {
                        url: 'https://www.amazon.com/s?k=laptop',
                        maxProducts: 20,
                        includeImages: true,
                        includeReviews: true
                    },
                    description: 'Scrapes Amazon product list and returns AI-ready data'
                }
            }
        };

        logger.info(requestId, 'API documentation requested');
        res.json(documentation);
    }
}

module.exports = GetController;

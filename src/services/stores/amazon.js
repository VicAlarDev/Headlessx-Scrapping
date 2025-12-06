/**
 * Amazon Scraper Service v1.0.0
 * Specialized scraper for Amazon product listings
 */

const browserService = require('../browser');
const RenderingService = require('../rendering');
const GeminiService = require('../gemini');
const { logger, generateRequestId } = require('../../utils/logger');

class AmazonScraperService {
    // Amazon base URL for resolving relative links
    static AMAZON_BASE_URL = 'https://www.amazon.com';

    // Amazon-specific selectors
    static SELECTORS = {
        // Main search results container
        searchResultsContainer: 'span[data-component-type="s-search-results"]',
        // Individual product items
        productItem: '[data-component-type="s-search-result"]',
        // Alternative selectors
        productItemAlt: '.s-result-item[data-asin]',
        // Product details - Updated with correct selectors
        titleLink: 'a.a-link-normal.s-line-clamp-2.s-link-style.a-text-normal',
        titleLinkAlt: 'h2 a.a-link-normal',
        titleText: 'h2 span, h2 a span',
        // Price selectors - Updated based on actual Amazon HTML
        priceContainer: 'a.a-link-normal.s-no-hover.s-underline-text span.a-price',
        priceOffscreen: 'span.a-price span.a-offscreen',
        priceWhole: 'span.a-price-whole',
        priceFraction: 'span.a-price-fraction',
        // Original/Typical price (strikethrough)
        originalPrice: 'span.a-price.a-text-price span.a-offscreen',
        typicalPrice: 'span.a-price.a-text-price[data-a-strike="true"] span.a-offscreen',
        image: '.s-image',
        rating: '.a-icon-star-small .a-icon-alt, [aria-label*="stars"]',
        reviewCount: '.a-size-base.s-underline-text',
        prime: '.a-icon-prime, .s-prime',
        sponsored: '.a-color-secondary:contains("Sponsored")',
        // Pagination selectors
        paginationContainer: '.s-pagination-container',
        currentPage: '.s-pagination-selected',
        nextPage: 'a.s-pagination-next',
        prevPage: 'a.s-pagination-previous, span.s-pagination-previous',
        pageLinks: 'a.s-pagination-button',
        totalPages: '.s-pagination-item:not(.s-pagination-ellipsis):last-of-type'
    };

    /**
     * Extract the search results container HTML from Amazon page
     */
    static async extractSearchResultsHtml(fullHtml) {
        const requestId = generateRequestId();

        try {
            const browser = await browserService.getBrowser();
            const context = await browserService.createIsolatedContext(browser, {});
            const page = await context.newPage();

            await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Extract only the search results container
            const searchResultsHtml = await page.evaluate((selectors) => {
                // Try main selector first
                let container = document.querySelector(selectors.searchResultsContainer);

                if (!container) {
                    // Fallback: try to find the results grid
                    container = document.querySelector('.s-main-slot.s-result-list');
                }

                if (!container) {
                    // Last resort: find all product items and wrap them
                    const items = document.querySelectorAll(selectors.productItem);
                    if (items.length > 0) {
                        const wrapper = document.createElement('div');
                        items.forEach(item => wrapper.appendChild(item.cloneNode(true)));
                        return wrapper.innerHTML;
                    }
                    return null;
                }

                // Clean the container - remove scripts, styles, ads
                const clone = container.cloneNode(true);

                // Remove unwanted elements
                const removeSelectors = [
                    'script', 'style', 'noscript',
                    '.AdHolder', '[data-component-type="sp-sponsored-result"]',
                    '.s-ad-feedback-text', '.puis-sponsored-label-text'
                ];

                removeSelectors.forEach(sel => {
                    clone.querySelectorAll(sel).forEach(el => el.remove());
                });

                // Remove inline styles to reduce size
                clone.querySelectorAll('[style]').forEach(el => {
                    el.removeAttribute('style');
                });

                // Remove data attributes except essential ones
                clone.querySelectorAll('*').forEach(el => {
                    Array.from(el.attributes).forEach(attr => {
                        if (attr.name.startsWith('data-') &&
                            !['data-asin', 'data-component-type'].includes(attr.name)) {
                            el.removeAttribute(attr.name);
                        }
                    });
                });

                return clone.innerHTML;
            }, this.SELECTORS);

            await context.close();

            if (!searchResultsHtml) {
                logger.warn(requestId, 'Could not find Amazon search results container');
                return null;
            }

            logger.info(requestId, `Extracted Amazon search results HTML: ${searchResultsHtml.length} chars`);
            return searchResultsHtml;
        } catch (error) {
            logger.error(requestId, 'Failed to extract Amazon search results', { error: error.message });
            throw error;
        }
    }

    /**
     * Pre-extract basic product data without AI (for fallback or quick extraction)
     */
    static async extractProductsBasic(html) {
        const requestId = generateRequestId();

        try {
            const browser = await browserService.getBrowser();
            const context = await browserService.createIsolatedContext(browser, {});
            const page = await context.newPage();

            await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const products = await page.evaluate((selectors) => {
                const items = document.querySelectorAll(selectors.productItem + ', ' + selectors.productItemAlt);
                const results = [];
                const seenAsins = new Set();

                items.forEach((item, index) => {
                    const asin = item.getAttribute('data-asin');
                    if (!asin || seenAsins.has(asin)) return;
                    seenAsins.add(asin);

                    const product = { asin, index: index + 1 };

                    // Title and Link - Use the combined selector that has both
                    // Primary: a.a-link-normal.s-line-clamp-2.s-link-style.a-text-normal
                    let titleLinkEl = item.querySelector(selectors.titleLink);
                    if (!titleLinkEl) {
                        titleLinkEl = item.querySelector(selectors.titleLinkAlt);
                    }

                    if (titleLinkEl) {
                        // Get the href (product URL)
                        const href = titleLinkEl.getAttribute('href');
                        if (href) {
                            // Convert relative URL to absolute
                            product.productUrl = href.startsWith('http')
                                ? href
                                : 'https://www.amazon.com' + href;
                        }

                        // Get the title from h2 span inside the link
                        const titleSpan = titleLinkEl.querySelector('h2 span, span');
                        if (titleSpan) {
                            product.name = titleSpan.textContent.trim();
                        } else {
                            // Fallback to aria-label on h2
                            const h2El = titleLinkEl.querySelector('h2');
                            if (h2El) {
                                product.name = h2El.getAttribute('aria-label') || h2El.textContent.trim();
                            }
                        }
                    }

                    // Fallback for title if not found
                    if (!product.name) {
                        const titleEl = item.querySelector(selectors.titleText);
                        if (titleEl) {
                            product.name = titleEl.textContent.trim();
                        }
                    }

                    // Price - Use the offscreen price which has the clean value
                    const priceOffscreen = item.querySelector(selectors.priceOffscreen);
                    if (priceOffscreen) {
                        const priceText = priceOffscreen.textContent.trim();
                        product.priceText = priceText;
                        // Extract currency symbol
                        const currencyMatch = priceText.match(/^([^\d]+)/);
                        if (currencyMatch) {
                            product.currency = currencyMatch[1].trim() === '$' ? 'USD' : currencyMatch[1].trim();
                        }
                        // Extract numeric price
                        const priceMatch = priceText.replace(/[^0-9.,]/g, '');
                        if (priceMatch) {
                            // Handle both formats: 369.99 or 369,99
                            product.price = parseFloat(priceMatch.replace(',', ''));
                        }
                    } else {
                        // Fallback: try to build price from whole + fraction
                        const wholeEl = item.querySelector(selectors.priceWhole);
                        const fractionEl = item.querySelector(selectors.priceFraction);
                        if (wholeEl) {
                            const whole = wholeEl.textContent.replace(/[^0-9]/g, '');
                            const fraction = fractionEl ? fractionEl.textContent.replace(/[^0-9]/g, '') : '00';
                            product.price = parseFloat(`${whole}.${fraction}`);
                            product.currency = 'USD';
                        }
                    }

                    // Original/Typical price (for discounts) - strikethrough price
                    let origPriceEl = item.querySelector(selectors.typicalPrice);
                    if (!origPriceEl) {
                        origPriceEl = item.querySelector(selectors.originalPrice);
                    }
                    if (origPriceEl) {
                        const origText = origPriceEl.textContent.trim();
                        const origMatch = origText.replace(/[^0-9.,]/g, '');
                        if (origMatch) {
                            product.originalPrice = parseFloat(origMatch.replace(',', ''));
                            // Calculate discount percentage
                            if (product.price && product.originalPrice > product.price) {
                                product.discount = Math.round((1 - product.price / product.originalPrice) * 100);
                            }
                        }
                    }

                    // Image
                    const imgEl = item.querySelector(selectors.image);
                    if (imgEl) {
                        product.imageUrl = imgEl.src || imgEl.getAttribute('data-src');
                    }

                    // Rating
                    const ratingEl = item.querySelector(selectors.rating);
                    if (ratingEl) {
                        const ratingText = ratingEl.textContent || ratingEl.getAttribute('aria-label') || '';
                        const ratingMatch = ratingText.match(/[\d.]+/);
                        if (ratingMatch) {
                            product.rating = parseFloat(ratingMatch[0]);
                        }
                    }

                    // Review count
                    const reviewEl = item.querySelector(selectors.reviewCount);
                    if (reviewEl) {
                        const reviewText = reviewEl.textContent.trim();
                        const reviewMatch = reviewText.replace(/[^0-9]/g, '');
                        if (reviewMatch) {
                            product.reviewCount = parseInt(reviewMatch, 10);
                        }
                    }

                    // Prime
                    const primeEl = item.querySelector(selectors.prime);
                    product.isPrime = !!primeEl;

                    if (product.name || product.productUrl) {
                        results.push(product);
                    }
                });

                return results;
            }, this.SELECTORS);

            await context.close();

            logger.info(requestId, `Basic extraction found ${products.length} products`);
            return products;
        } catch (error) {
            logger.error(requestId, 'Basic product extraction failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Extract pagination information from the page
     */
    static async extractPagination(fullHtml, baseUrl) {
        const requestId = generateRequestId();

        try {
            const browser = await browserService.getBrowser();
            const context = await browserService.createIsolatedContext(browser, {});
            const page = await context.newPage();

            await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const pagination = await page.evaluate((selectors) => {
                const result = {
                    currentPage: 1,
                    totalPages: null,
                    hasNextPage: false,
                    hasPrevPage: false,
                    nextPageUrl: null,
                    prevPageUrl: null,
                    pages: []
                };

                // Current page
                const currentEl = document.querySelector(selectors.currentPage);
                if (currentEl) {
                    result.currentPage = parseInt(currentEl.textContent.trim(), 10) || 1;
                }

                // Next page
                const nextEl = document.querySelector(selectors.nextPage);
                if (nextEl && nextEl.tagName === 'A') {
                    result.hasNextPage = true;
                    result.nextPageUrl = nextEl.getAttribute('href');
                }

                // Previous page
                const prevEl = document.querySelector(selectors.prevPage);
                if (prevEl && prevEl.tagName === 'A') {
                    result.hasPrevPage = true;
                    result.prevPageUrl = prevEl.getAttribute('href');
                }

                // All page links
                const pageLinks = document.querySelectorAll(selectors.pageLinks);
                pageLinks.forEach(link => {
                    const pageNum = parseInt(link.textContent.trim(), 10);
                    if (!isNaN(pageNum)) {
                        result.pages.push({
                            page: pageNum,
                            url: link.getAttribute('href')
                        });
                    }
                });

                // Try to get total pages from last visible number
                const allPageItems = document.querySelectorAll('.s-pagination-item');
                allPageItems.forEach(item => {
                    const num = parseInt(item.textContent.trim(), 10);
                    if (!isNaN(num) && num > (result.totalPages || 0)) {
                        result.totalPages = num;
                    }
                });

                return result;
            }, this.SELECTORS);

            await context.close();

            // Convert relative URLs to absolute
            const amazonBase = this.getAmazonBaseUrl(baseUrl);
            if (pagination.nextPageUrl && !pagination.nextPageUrl.startsWith('http')) {
                pagination.nextPageUrl = amazonBase + pagination.nextPageUrl;
            }
            if (pagination.prevPageUrl && !pagination.prevPageUrl.startsWith('http')) {
                pagination.prevPageUrl = amazonBase + pagination.prevPageUrl;
            }
            pagination.pages = pagination.pages.map(p => ({
                ...p,
                url: p.url.startsWith('http') ? p.url : amazonBase + p.url
            }));

            logger.info(requestId, `Pagination: page ${pagination.currentPage}/${pagination.totalPages || '?'}`);
            return pagination;
        } catch (error) {
            logger.error(requestId, 'Pagination extraction failed', { error: error.message });
            return {
                currentPage: 1,
                totalPages: null,
                hasNextPage: false,
                hasPrevPage: false,
                nextPageUrl: null,
                prevPageUrl: null,
                pages: []
            };
        }
    }

    /**
     * Get Amazon base URL from a given URL
     */
    static getAmazonBaseUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.host}`;
        } catch {
            return 'https://www.amazon.com';
        }
    }

    /**
     * Build URL for a specific page
     */
    static buildPageUrl(baseUrl, page) {
        try {
            const urlObj = new URL(baseUrl);
            urlObj.searchParams.set('page', page.toString());
            return urlObj.toString();
        } catch {
            // Fallback: append page parameter
            const separator = baseUrl.includes('?') ? '&' : '?';
            return `${baseUrl}${separator}page=${page}`;
        }
    }

    /**
     * Full Amazon product list scraping with Gemini AI
     */
    static async scrapeProductList(url, options = {}) {
        const requestId = generateRequestId();
        const {
            useAI = true,
            maxProducts = 50,
            timeout = 90000,
            language = 'es',
            includeImages = true,
            page = null // If specified, will navigate to that page
        } = options;

        // Build URL with page parameter if specified
        let targetUrl = url;
        if (page && page > 1) {
            targetUrl = this.buildPageUrl(url, page);
        }

        logger.info(requestId, `Starting Amazon scrape: ${targetUrl} (page: ${page || 1})`);

        try {
            // Step 1: Render the page with anti-detection
            logger.info(requestId, 'Rendering Amazon page...');
            const renderResult = await RenderingService.renderPageAdvanced({
                url: targetUrl,
                scrollToBottom: true,
                waitForNetworkIdle: true,
                timeout,
                returnPartialOnTimeout: true,
                waitForSelectors: [this.SELECTORS.searchResultsContainer],
                extraWaitTime: 5000
            });

            logger.info(requestId, `Page rendered: ${renderResult.html.length} chars`);

            // Step 2: Extract pagination info
            const pagination = await this.extractPagination(renderResult.html, targetUrl);

            // Step 3: Extract only the search results container
            const searchResultsHtml = await this.extractSearchResultsHtml(renderResult.html);

            if (!searchResultsHtml) {
                throw new Error('Could not find Amazon search results on page');
            }

            logger.info(requestId, `Search results extracted: ${searchResultsHtml.length} chars`);

            // Step 4: Basic extraction (always do this as fallback)
            const basicProducts = await this.extractProductsBasic(searchResultsHtml);
            logger.info(requestId, `Basic extraction: ${basicProducts.length} products`);

            // Step 5: AI extraction if enabled and configured
            let aiProducts = null;
            let aiMetadata = null;

            if (useAI && GeminiService.isConfigured()) {
                try {
                    logger.info(requestId, 'Sending to Gemini for AI extraction...');
                    const aiResult = await GeminiService.extractProducts(searchResultsHtml, {
                        maxProducts,
                        language,
                        includeImages,
                        site: 'amazon'
                    });
                    aiProducts = aiResult.products;
                    aiMetadata = aiResult.metadata;
                    logger.info(requestId, `AI extraction: ${aiProducts?.length || 0} products`);
                } catch (aiError) {
                    logger.warn(requestId, 'AI extraction failed, using basic extraction', {
                        error: aiError.message
                    });
                }
            } else if (useAI && !GeminiService.isConfigured()) {
                logger.warn(requestId, 'Gemini AI not configured, using basic extraction only');
            }

            // Use AI results if available, otherwise fall back to basic
            const products = aiProducts || basicProducts;

            return {
                success: true,
                url: renderResult.url,
                originalUrl: url,
                site: 'amazon',
                products,
                productCount: products.length,
                pagination,
                extraction: {
                    method: aiProducts ? 'gemini-ai' : 'basic',
                    aiAvailable: GeminiService.isConfigured(),
                    aiUsed: !!aiProducts
                },
                metadata: {
                    timestamp: new Date().toISOString(),
                    wasTimeout: renderResult.wasTimeout,
                    originalHtmlLength: renderResult.html.length,
                    searchResultsHtmlLength: searchResultsHtml.length,
                    compressionRatio: ((1 - searchResultsHtml.length / renderResult.html.length) * 100).toFixed(2) + '%',
                    ...(aiMetadata || {})
                },
                // Include raw HTML for debugging/custom processing
                rawSearchResultsHtml: options.includeRawHtml ? searchResultsHtml : undefined
            };
        } catch (error) {
            logger.error(requestId, 'Amazon scrape failed', { error: error.message });
            throw error;
        }
    }

    // Selectors for single product detail page
    static PRODUCT_DETAIL_SELECTORS = {
        // Product title
        title: '#productTitle',
        // Price - current price
        currentPrice: '.priceToPay .a-offscreen, .priceToPay span.a-price-whole',
        priceWhole: '.priceToPay .a-price-whole',
        priceFraction: '.priceToPay .a-price-fraction',
        // Discount percentage
        discountPercent: '.savingsPercentage, .savingPriceOverride',
        // Original/Typical price
        typicalPrice: '.basisPrice .a-price .a-offscreen, span.a-price.a-text-price[data-a-strike="true"] .a-offscreen',
        // ASIN
        asin: 'th:contains("ASIN") + td, input[name="ASIN"]',
        // Seller
        seller: '#sellerProfileTriggerId, .offer-display-feature-text-message',
        // Availability
        availability: '#availability span',
        // Rating
        rating: '#acrPopover, .a-icon-star span.a-icon-alt',
        reviewCount: '#acrCustomerReviewText',
        // Images
        mainImage: '#landingImage, #imgBlkFront',
        thumbnails: '.imageThumbnail img, #altImages img',
        // Features/Bullets
        featureBullets: '#feature-bullets li span',
        // Description
        description: '#productDescription p, #productDescription span'
    };

    /**
     * Scrape a single product page
     */
    static async scrapeProductDetail(url, options = {}) {
        const requestId = generateRequestId();
        const { useAI = true, language = 'es' } = options;

        logger.info(requestId, `Scraping Amazon product detail: ${url}`);

        try {
            const renderResult = await RenderingService.renderPageAdvanced({
                url,
                scrollToBottom: true,
                waitForNetworkIdle: true,
                timeout: options.timeout || 60000,
                returnPartialOnTimeout: true,
                waitForSelectors: ['#productTitle'],
                extraWaitTime: 3000
            });

            const browser = await browserService.getBrowser();
            const context = await browserService.createIsolatedContext(browser, {});
            const page = await context.newPage();

            await page.setContent(renderResult.html, { waitUntil: 'domcontentloaded' });

            // Extract product data using selectors
            const productData = await page.evaluate((selectors) => {
                const product = {};

                // Title
                const titleEl = document.querySelector(selectors.title);
                if (titleEl) {
                    product.name = titleEl.textContent.trim();
                }

                // Current Price
                const priceOffscreen = document.querySelector('.priceToPay .a-offscreen');
                if (priceOffscreen) {
                    const priceText = priceOffscreen.textContent.trim();
                    product.priceText = priceText;
                    const currencyMatch = priceText.match(/^([^\d]+)/);
                    if (currencyMatch) {
                        product.currency = currencyMatch[1].trim() === '$' ? 'USD' : currencyMatch[1].trim();
                    }
                    const priceMatch = priceText.replace(/[^0-9.,]/g, '');
                    if (priceMatch) {
                        product.price = parseFloat(priceMatch.replace(',', ''));
                    }
                } else {
                    // Fallback: build from whole + fraction
                    const wholeEl = document.querySelector(selectors.priceWhole);
                    const fractionEl = document.querySelector(selectors.priceFraction);
                    if (wholeEl) {
                        const whole = wholeEl.textContent.replace(/[^0-9]/g, '');
                        const fraction = fractionEl ? fractionEl.textContent.replace(/[^0-9]/g, '') : '00';
                        product.price = parseFloat(`${whole}.${fraction}`);
                        product.currency = 'USD';
                    }
                }

                // Discount percentage
                const discountEl = document.querySelector(selectors.discountPercent);
                if (discountEl) {
                    const discountText = discountEl.textContent.trim();
                    const discountMatch = discountText.match(/(\d+)/);
                    if (discountMatch) {
                        product.discount = parseInt(discountMatch[1], 10);
                    }
                }

                // Original/Typical price
                const typicalEl = document.querySelector(selectors.typicalPrice);
                if (typicalEl) {
                    const typicalText = typicalEl.textContent.trim();
                    const typicalMatch = typicalText.replace(/[^0-9.,]/g, '');
                    if (typicalMatch) {
                        product.originalPrice = parseFloat(typicalMatch.replace(',', ''));
                    }
                }

                // Calculate discount if not found but we have both prices
                if (!product.discount && product.price && product.originalPrice) {
                    if (product.originalPrice > product.price) {
                        product.discount = Math.round((1 - product.price / product.originalPrice) * 100);
                    }
                }

                // ASIN - try multiple methods
                const asinInput = document.querySelector('input[name="ASIN"]');
                if (asinInput) {
                    product.asin = asinInput.value;
                } else {
                    // Try from table
                    const asinRow = document.evaluate(
                        '//th[contains(text(),\'ASIN\')]/following-sibling::td',
                        document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                    ).singleNodeValue;
                    if (asinRow) {
                        product.asin = asinRow.textContent.trim();
                    }
                }

                // Seller
                const sellerEl = document.querySelector(selectors.seller);
                if (sellerEl) {
                    product.seller = sellerEl.textContent.trim();
                }

                // Availability
                const availEl = document.querySelector(selectors.availability);
                if (availEl) {
                    product.availability = availEl.textContent.trim();
                }

                // Rating
                const ratingEl = document.querySelector('#acrPopover');
                if (ratingEl) {
                    const ratingTitle = ratingEl.getAttribute('title') || '';
                    const ratingMatch = ratingTitle.match(/[\d.]+/);
                    if (ratingMatch) {
                        product.rating = parseFloat(ratingMatch[0]);
                    }
                } else {
                    const starEl = document.querySelector('.a-icon-star span.a-icon-alt');
                    if (starEl) {
                        const starText = starEl.textContent;
                        const starMatch = starText.match(/[\d.]+/);
                        if (starMatch) {
                            product.rating = parseFloat(starMatch[0]);
                        }
                    }
                }

                // Review count
                const reviewEl = document.querySelector(selectors.reviewCount);
                if (reviewEl) {
                    const reviewText = reviewEl.textContent.trim();
                    const reviewMatch = reviewText.replace(/[^0-9]/g, '');
                    if (reviewMatch) {
                        product.reviewCount = parseInt(reviewMatch, 10);
                    }
                }

                // Main image
                const mainImgEl = document.querySelector(selectors.mainImage);
                if (mainImgEl) {
                    product.mainImage = mainImgEl.src || mainImgEl.getAttribute('data-old-hires') ||
                        mainImgEl.getAttribute('data-a-dynamic-image');
                    // Try to get high-res from data attribute
                    const dynamicImage = mainImgEl.getAttribute('data-a-dynamic-image');
                    if (dynamicImage) {
                        try {
                            const imageObj = JSON.parse(dynamicImage);
                            const urls = Object.keys(imageObj);
                            if (urls.length > 0) {
                                // Get the largest image
                                product.mainImage = urls[urls.length - 1];
                            }
                        } catch (e) {
                            // Keep the src
                        }
                    }
                }

                // Thumbnail images
                const thumbEls = document.querySelectorAll('#altImages img.a-dynamic-image, .imageThumbnail img');
                product.images = [];
                if (product.mainImage) {
                    product.images.push(product.mainImage);
                }
                thumbEls.forEach(img => {
                    let imgUrl = img.src;
                    // Convert thumbnail to full size
                    if (imgUrl && imgUrl.includes('._')) {
                        imgUrl = imgUrl.replace(/\._[^.]+\./, '.');
                    }
                    if (imgUrl && !product.images.includes(imgUrl)) {
                        product.images.push(imgUrl);
                    }
                });

                // Feature bullets
                const bulletEls = document.querySelectorAll('#feature-bullets li:not(.aok-hidden) span.a-list-item');
                product.features = [];
                bulletEls.forEach(bullet => {
                    const text = bullet.textContent.trim();
                    if (text && text.length > 5 && !text.includes('Make sure this fits')) {
                        product.features.push(text);
                    }
                });

                // Description
                const descEl = document.querySelector('#productDescription p, #productDescription span');
                if (descEl) {
                    product.description = descEl.textContent.trim().substring(0, 500);
                }

                return product;
            }, this.PRODUCT_DETAIL_SELECTORS);

            await context.close();

            // If AI is enabled and configured, enhance with AI
            if (useAI && GeminiService.isConfigured() && (!productData.name || !productData.price)) {
                logger.info(requestId, 'Basic extraction incomplete, using AI...');

                // Get clean HTML for AI
                const productHtml = await this.extractProductDetailHtml(renderResult.html);

                const prompt = language === 'es'
                    ? `Extrae la información del producto de Amazon del siguiente HTML.
                       
                       IMPORTANTE:
                       - El título está en: <span id="productTitle">NOMBRE</span>
                       - El precio actual está en: <span class="priceToPay">...<span class="a-offscreen">$169.50</span>
                       - El descuento está en: <span class="savingsPercentage">-6%</span>
                       - El precio típico/original está en: <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$180.90</span>
                       - El vendedor está en: <a id="sellerProfileTriggerId">VENDEDOR</a>
                       - La disponibilidad está en: <div id="availability"><span>DISPONIBILIDAD</span>
                       - El ASIN está en la tabla de detalles
                       
                       Responde SOLO con JSON válido:
                       {
                         "name": "nombre del producto",
                         "price": número,
                         "currency": "USD",
                         "originalPrice": número o null,
                         "discount": porcentaje numérico o null,
                         "rating": número 0-5 o null,
                         "reviewCount": número o null,
                         "availability": "texto de disponibilidad",
                         "seller": "nombre del vendedor",
                         "asin": "código ASIN"
                       }`
                    : `Extract product information from the following Amazon HTML.
                       
                       IMPORTANT:
                       - Title is in: <span id="productTitle">NAME</span>
                       - Current price is in: <span class="priceToPay">...<span class="a-offscreen">$169.50</span>
                       - Discount is in: <span class="savingsPercentage">-6%</span>
                       - Typical/original price is in: <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$180.90</span>
                       - Seller is in: <a id="sellerProfileTriggerId">SELLER</a>
                       - Availability is in: <div id="availability"><span>AVAILABILITY</span>
                       - ASIN is in the details table
                       
                       Respond ONLY with valid JSON:
                       {
                         "name": "product name",
                         "price": number,
                         "currency": "USD",
                         "originalPrice": number or null,
                         "discount": numeric percentage or null,
                         "rating": number 0-5 or null,
                         "reviewCount": number or null,
                         "availability": "availability text",
                         "seller": "seller name",
                         "asin": "ASIN code"
                       }`;

                try {
                    const aiResult = await GeminiService.analyzeContent(productHtml, prompt);
                    // Merge AI results with basic extraction
                    const mergedProduct = { ...productData, ...aiResult.data };

                    return {
                        success: true,
                        url: renderResult.url,
                        product: mergedProduct,
                        extraction: { method: 'gemini-ai', enhanced: true },
                        metadata: {
                            timestamp: new Date().toISOString(),
                            ...aiResult.metadata
                        }
                    };
                } catch (aiError) {
                    logger.warn(requestId, 'AI enhancement failed', { error: aiError.message });
                }
            }

            // Return basic extraction
            logger.info(requestId, `Product extracted: ${productData.name || 'Unknown'}`);

            return {
                success: true,
                url: renderResult.url,
                product: productData,
                extraction: {
                    method: 'basic',
                    aiAvailable: GeminiService.isConfigured()
                },
                metadata: {
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            logger.error(requestId, 'Amazon product detail scrape failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Extract clean HTML from product detail page for AI processing
     */
    static async extractProductDetailHtml(fullHtml) {
        const browser = await browserService.getBrowser();
        const context = await browserService.createIsolatedContext(browser, {});
        const page = await context.newPage();

        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const cleanHtml = await page.evaluate(() => {
            // Select only relevant sections
            const relevantSelectors = [
                '#productTitle',
                '#apex_desktop', // Price section
                '#corePrice_desktop',
                '#corePriceDisplay_desktop_feature_div',
                '#availability',
                '#merchant-info',
                '#sellerProfileTriggerId',
                '#acrPopover',
                '#acrCustomerReviewText',
                '#productDetails_techSpec_section_1',
                '#productDetails_detailBullets_sections1',
                '#feature-bullets'
            ];

            let html = '';
            relevantSelectors.forEach(sel => {
                const el = document.querySelector(sel);
                if (el) {
                    const clone = el.cloneNode(true);
                    // Remove scripts and styles
                    clone.querySelectorAll('script, style, noscript, iframe').forEach(e => e.remove());
                    // Remove inline styles
                    clone.querySelectorAll('[style]').forEach(e => e.removeAttribute('style'));
                    html += clone.outerHTML + '\n';
                }
            });

            return html || document.body.innerHTML.substring(0, 50000);
        });

        await context.close();
        return cleanHtml;
    }
}

module.exports = AmazonScraperService;

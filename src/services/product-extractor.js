/**
 * Product Extractor Service v1.0.0
 * Extracts minimal, AI-ready product data from e-commerce pages
 * Designed to work with Gemini, GPT, Claude, etc.
 */

const browserService = require('./browser');
const RenderingService = require('./rendering');
const { logger, generateRequestId } = require('../utils/logger');

class ProductExtractorService {
    /**
     * Extract minimal HTML with only product-relevant elements
     * Optimized for AI processing
     */
    static async extractMinimalProductHtml(html, options = {}) {
        const {
            includeImages = true,
            includeLinks = true,
            includePrices = true,
            includeReviews = true,
            maxProducts = 50,
            site = 'generic'
        } = options;

        try {
            const browser = await browserService.getBrowser();
            const context = await browserService.createIsolatedContext(browser, {});
            const page = await context.newPage();

            await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const extractedData = await page.evaluate((opts) => {
                // Site-specific selectors
                const siteSelectors = {
                    amazon: {
                        productContainer: '[data-component-type="s-search-result"], .s-result-item, .sg-col-inner',
                        title: 'h2 a span, .a-size-medium, .a-size-base-plus, .a-text-normal',
                        price: '.a-price .a-offscreen, .a-price-whole, .a-color-price, span.a-price',
                        image: '.s-image, .s-product-image-container img',
                        link: 'h2 a, .a-link-normal[href*="/dp/"]',
                        rating: '.a-icon-star-small, .a-icon-alt, [data-cy="reviews-ratings-slot"]',
                        reviews: '.a-size-base.s-underline-text, [aria-label*="stars"]'
                    },
                    ebay: {
                        productContainer: '.s-item, .srp-results .s-item__wrapper',
                        title: '.s-item__title, .s-item__title span',
                        price: '.s-item__price',
                        image: '.s-item__image img',
                        link: '.s-item__link',
                        rating: '.x-star-rating',
                        reviews: '.s-item__reviews-count'
                    },
                    walmart: {
                        productContainer: '[data-item-id], .search-result-gridview-item',
                        title: '[data-automation-id="product-title"], .product-title-link',
                        price: '[data-automation-id="product-price"], .price-main',
                        image: '[data-automation-id="product-image"] img, .product-image img',
                        link: '[data-automation-id="product-title"], a[link-identifier]',
                        rating: '.stars-container',
                        reviews: '.stars-reviews-count'
                    },
                    aliexpress: {
                        productContainer: '.search-item-card-wrapper-gallery, .list--gallery--C2f2tvm',
                        title: '.multi--titleText--nXeOvyr, h1.title',
                        price: '.multi--price-sale--U-S0jtj, .price-current',
                        image: '.images--item--3XZa6xf img, .product-img img',
                        link: 'a[href*="/item/"]',
                        rating: '.multi--starRating--2GRtuby',
                        reviews: '.multi--trade--Ktbl2jB'
                    },
                    mercadolibre: {
                        productContainer: '.ui-search-result, .andes-card',
                        title: '.ui-search-item__title, .poly-component__title',
                        price: '.ui-search-price__second-line, .andes-money-amount',
                        image: '.ui-search-result-image__element, .poly-component__picture img',
                        link: '.ui-search-link, .poly-component__title a',
                        rating: '.ui-search-reviews__rating-number',
                        reviews: '.ui-search-reviews__amount'
                    },
                    generic: {
                        productContainer: '[class*="product"], [class*="item"], [data-product], article',
                        title: '[class*="title"], [class*="name"], h2, h3',
                        price: '[class*="price"], [class*="cost"], [class*="amount"]',
                        image: 'img[src*="product"], img[class*="product"], img[alt]',
                        link: 'a[href*="product"], a[href*="item"], a[href*="dp"]',
                        rating: '[class*="rating"], [class*="star"]',
                        reviews: '[class*="review"], [class*="comment"]'
                    }
                };

                const selectors = siteSelectors[opts.site] || siteSelectors.generic;
                const products = [];
                const seenUrls = new Set();

                // Find product containers
                const containers = document.querySelectorAll(selectors.productContainer);

                containers.forEach((container, index) => {
                    if (index >= opts.maxProducts) return;

                    const product = {
                        index: index + 1
                    };

                    // Extract title
                    const titleEl = container.querySelector(selectors.title);
                    if (titleEl) {
                        product.title = titleEl.textContent.trim().substring(0, 200);
                    }

                    // Extract price
                    if (opts.includePrices) {
                        const priceEl = container.querySelector(selectors.price);
                        if (priceEl) {
                            product.priceText = priceEl.textContent.trim();
                            // Try to extract numeric price
                            const priceMatch = product.priceText.match(/[\d,.]+/);
                            if (priceMatch) {
                                product.priceNumeric = priceMatch[0];
                            }
                        }
                    }

                    // Extract image URL
                    if (opts.includeImages) {
                        const imgEl = container.querySelector(selectors.image);
                        if (imgEl) {
                            product.imageUrl = imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy-src');
                        }
                    }

                    // Extract product link
                    if (opts.includeLinks) {
                        const linkEl = container.querySelector(selectors.link);
                        if (linkEl) {
                            product.productUrl = linkEl.href;
                            // Skip if we've seen this URL
                            if (seenUrls.has(product.productUrl)) return;
                            seenUrls.add(product.productUrl);
                        }
                    }

                    // Extract rating
                    if (opts.includeReviews) {
                        const ratingEl = container.querySelector(selectors.rating);
                        if (ratingEl) {
                            const ratingText = ratingEl.textContent || ratingEl.getAttribute('aria-label') || '';
                            const ratingMatch = ratingText.match(/[\d.]+/);
                            if (ratingMatch) {
                                product.rating = ratingMatch[0];
                            }
                        }

                        const reviewsEl = container.querySelector(selectors.reviews);
                        if (reviewsEl) {
                            const reviewsText = reviewsEl.textContent.trim();
                            const reviewsMatch = reviewsText.match(/[\d,]+/);
                            if (reviewsMatch) {
                                product.reviewCount = reviewsMatch[0].replace(/,/g, '');
                            }
                        }
                    }

                    // Only add if we have at least a title or link
                    if (product.title || product.productUrl) {
                        products.push(product);
                    }
                });

                return products;
            }, {
                includeImages,
                includeLinks,
                includePrices,
                includeReviews,
                maxProducts,
                site
            });

            await context.close();
            return extractedData;
        } catch (error) {
            console.error('Error extracting product data:', error);
            throw error;
        }
    }

    /**
     * Generate minimal HTML optimized for AI processing
     * Returns a simplified HTML structure with only essential product info
     */
    static async generateAIReadyHtml(html, options = {}) {
        const products = await this.extractMinimalProductHtml(html, options);

        // Generate minimal HTML structure
        let minimalHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Product List</title></head><body>\n';
        minimalHtml += '<div id="products">\n';

        products.forEach(product => {
            minimalHtml += `<article class="product" data-index="${product.index}">\n`;

            if (product.title) {
                minimalHtml += `  <h3 class="title">${this.escapeHtml(product.title)}</h3>\n`;
            }

            if (product.priceText) {
                minimalHtml += `  <span class="price">${this.escapeHtml(product.priceText)}</span>\n`;
            }

            if (product.productUrl) {
                minimalHtml += `  <a class="link" href="${this.escapeHtml(product.productUrl)}">Ver producto</a>\n`;
            }

            if (product.imageUrl) {
                minimalHtml += `  <img class="image" src="${this.escapeHtml(product.imageUrl)}" alt="${this.escapeHtml(product.title || 'Product')}">\n`;
            }

            if (product.rating) {
                minimalHtml += `  <span class="rating">${product.rating} estrellas</span>\n`;
            }

            if (product.reviewCount) {
                minimalHtml += `  <span class="reviews">${product.reviewCount} reseñas</span>\n`;
            }

            minimalHtml += '</article>\n';
        });

        minimalHtml += '</div>\n</body></html>';

        return {
            html: minimalHtml,
            products,
            productCount: products.length,
            htmlLength: minimalHtml.length
        };
    }

    /**
     * Generate a prompt-ready text for AI processing
     */
    static generateAIPrompt(products, options = {}) {
        const {
            format = 'json',
            language = 'es',
            includeInstructions = true
        } = options;

        let prompt = '';

        if (includeInstructions) {
            if (language === 'es') {
                prompt += `Analiza la siguiente lista de productos y extrae la información en formato ${format.toUpperCase()}.\n`;
                prompt += 'Para cada producto, extrae: nombre, precio (número), moneda, URL del producto, URL de la imagen, calificación, número de reseñas.\n';
                prompt += 'Si algún campo no está disponible, usa null.\n\n';
            } else {
                prompt += `Analyze the following product list and extract information in ${format.toUpperCase()} format.\n`;
                prompt += 'For each product, extract: name, price (number), currency, product URL, image URL, rating, review count.\n';
                prompt += 'If any field is not available, use null.\n\n';
            }
        }

        prompt += 'PRODUCTOS:\n';
        prompt += '---\n';

        products.forEach((product, index) => {
            prompt += `[${index + 1}]\n`;
            if (product.title) prompt += `Título: ${product.title}\n`;
            if (product.priceText) prompt += `Precio: ${product.priceText}\n`;
            if (product.productUrl) prompt += `URL: ${product.productUrl}\n`;
            if (product.imageUrl) prompt += `Imagen: ${product.imageUrl}\n`;
            if (product.rating) prompt += `Rating: ${product.rating}\n`;
            if (product.reviewCount) prompt += `Reseñas: ${product.reviewCount}\n`;
            prompt += '---\n';
        });

        return prompt;
    }

    /**
     * Detect the e-commerce site from URL
     */
    static detectSite(url) {
        const urlLower = url.toLowerCase();

        if (urlLower.includes('amazon.')) return 'amazon';
        if (urlLower.includes('ebay.')) return 'ebay';
        if (urlLower.includes('walmart.')) return 'walmart';
        if (urlLower.includes('aliexpress.')) return 'aliexpress';
        if (urlLower.includes('mercadolibre.') || urlLower.includes('mercadolivre.')) return 'mercadolibre';

        return 'generic';
    }

    /**
     * Helper to escape HTML
     */
    static escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Full scraping pipeline: fetch page and extract products
     */
    static async scrapeProductList(url, options = {}) {
        const requestId = generateRequestId();
        const site = options.site || this.detectSite(url);

        logger.info(requestId, `Starting product scrape for ${site}: ${url}`);

        try {
            // Render the page with anti-detection
            const renderResult = await RenderingService.renderPageAdvanced({
                url,
                scrollToBottom: true,
                waitForNetworkIdle: true,
                timeout: options.timeout || 60000,
                returnPartialOnTimeout: true,
                ...options.renderOptions
            });

            logger.info(requestId, 'Page rendered, extracting products...');

            // Extract products
            const extractOptions = {
                ...options,
                site
            };

            const products = await this.extractMinimalProductHtml(renderResult.html, extractOptions);

            logger.info(requestId, 'Extracted ' + products.length + ' products');

            // Generate AI-ready content
            const aiPrompt = this.generateAIPrompt(products, options);
            const aiHtml = await this.generateAIReadyHtml(renderResult.html, extractOptions);

            return {
                success: true,
                url: renderResult.url,
                originalUrl: url,
                site,
                products,
                productCount: products.length,
                aiPrompt,
                aiReadyHtml: aiHtml.html,
                metadata: {
                    timestamp: new Date().toISOString(),
                    wasTimeout: renderResult.wasTimeout,
                    originalHtmlLength: renderResult.html.length,
                    minimalHtmlLength: aiHtml.htmlLength,
                    compressionRatio: ((1 - aiHtml.htmlLength / renderResult.html.length) * 100).toFixed(2) + '%'
                }
            };
        } catch (error) {
            logger.error(requestId, `Product scrape failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = ProductExtractorService;

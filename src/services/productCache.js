/**
 * Product Cache Service
 *
 * Handles caching of scraped products and search results
 * Implements 24-hour cache validation and cross-user sharing
 */

const db = require('./database');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

class ProductCacheService {
    // Cache duration in hours
    static CACHE_DURATION_HOURS = 24;

    /**
     * Generate URL hash for cache lookup
     */
    static hashUrl(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }

    /**
     * Amazon domain to country code mapping
     */
    static AMAZON_DOMAINS = {
        'amazon.com': 'US',
        'amazon.es': 'ES',
        'amazon.com.mx': 'MX',
        'amazon.co.uk': 'UK',
        'amazon.de': 'DE',
        'amazon.fr': 'FR',
        'amazon.it': 'IT',
        'amazon.ca': 'CA',
        'amazon.co.jp': 'JP',
        'amazon.com.br': 'BR',
        'amazon.com.au': 'AU',
        'amazon.in': 'IN',
        'amazon.nl': 'NL',
        'amazon.se': 'SE',
        'amazon.pl': 'PL',
        'amazon.ae': 'AE',
        'amazon.sa': 'SA',
        'amazon.sg': 'SG'
    };

    /**
     * Detect store from URL
     */
    static detectStoreFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.replace('www.', '');

            // Check Amazon domains
            for (const [domain, countryCode] of Object.entries(this.AMAZON_DOMAINS)) {
                if (hostname === domain || hostname.endsWith(`.${domain}`)) {
                    return {
                        platform: 'amazon',
                        countryCode,
                        storeName: `amazon_${countryCode.toLowerCase()}`,
                        domain: hostname
                    };
                }
            }

            // Default to amazon_us if it's an amazon domain but not matched
            if (hostname.includes('amazon')) {
                return {
                    platform: 'amazon',
                    countryCode: 'US',
                    storeName: 'amazon_us',
                    domain: hostname
                };
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get store ID by name or URL
     */
    static async getStoreId(storeNameOrUrl) {
        // First try to detect from URL
        const detected = this.detectStoreFromUrl(storeNameOrUrl);
        if (detected) {
            const query = `
                SELECT id, name, country_code FROM stores 
                WHERE country_code = $1 AND name ILIKE $2
                LIMIT 1
            `;
            const result = await db.query(query, [detected.countryCode, `%${detected.platform}%`]);
            if (result.rows.length > 0) {
                return result.rows[0].id;
            }
        }

        // Fallback to name/URL search
        const query = `
            SELECT id FROM stores 
            WHERE name ILIKE $1 
               OR base_url ILIKE $2
            LIMIT 1
        `;
        const result = await db.query(query, [
            `%${storeNameOrUrl}%`,
            `%${storeNameOrUrl}%`
        ]);
        return result.rows[0]?.id || 1; // Default to amazon_us
    }

    /**
     * Get store info by URL (returns full store details)
     */
    static async getStoreByUrl(url) {
        const detected = this.detectStoreFromUrl(url);
        if (!detected) {
            return null;
        }

        const query = `
            SELECT id, name, base_url, country_code, scrape_config
            FROM stores 
            WHERE country_code = $1 AND name ILIKE $2
            LIMIT 1
        `;
        const result = await db.query(query, [detected.countryCode, `%${detected.platform}%`]);

        if (result.rows.length > 0) {
            return {
                ...result.rows[0],
                detected
            };
        }

        return {
            id: 1,
            name: 'amazon_us',
            country_code: 'US',
            detected
        };
    }

    /**
     * Check if a URL has valid cached data (within 24 hours)
     */
    static async isCacheValid(url) {
        const urlHash = this.hashUrl(url);
        const query = `
            SELECT id, expires_at, created_at
            FROM search_queries
            WHERE query_url_hash = $1
              AND expires_at > NOW()
        `;
        const result = await db.query(query, [urlHash]);

        if (result.rows.length > 0) {
            return {
                valid: true,
                queryId: result.rows[0].id,
                expiresAt: result.rows[0].expires_at,
                cachedAt: result.rows[0].created_at
            };
        }

        return { valid: false };
    }

    /**
     * Check if a product URL has valid cached data
     */
    static async isProductCacheValid(url) {
        const urlHash = this.hashUrl(url);
        const query = `
            SELECT p.id, p.asin, p.last_scraped_at,
                   p.last_scraped_at + INTERVAL '${this.CACHE_DURATION_HOURS} hours' as expires_at
            FROM products p
            WHERE md5(p.product_url) = $1
              AND p.last_scraped_at > NOW() - INTERVAL '${this.CACHE_DURATION_HOURS} hours'
        `;
        const result = await db.query(query, [urlHash]);

        if (result.rows.length > 0) {
            return {
                valid: true,
                productId: result.rows[0].id,
                asin: result.rows[0].asin,
                lastScrapedAt: result.rows[0].last_scraped_at,
                expiresAt: result.rows[0].expires_at
            };
        }

        return { valid: false };
    }

    /**
     * Get cached search results
     */
    static async getCachedSearchResults(url) {
        const urlHash = this.hashUrl(url);

        const query = `
            SELECT 
                sq.id as query_id,
                sq.search_term,
                sq.page_number,
                sq.product_count,
                sq.created_at,
                sq.expires_at,
                json_agg(
                    json_build_object(
                        'id', p.id,
                        'asin', p.asin,
                        'name', p.name,
                        'productUrl', p.product_url,
                        'imageUrl', p.main_image_url,
                        'price', lp.price,
                        'originalPrice', lp.original_price,
                        'currency', lp.currency,
                        'discount', lp.discount_percent,
                        'rating', lp.rating,
                        'reviewCount', lp.review_count,
                        'availability', lp.availability,
                        'isPrime', lp.is_prime,
                        'position', sqp.position
                    ) ORDER BY sqp.position
                ) as products
            FROM search_queries sq
            JOIN search_query_products sqp ON sq.id = sqp.search_query_id
            JOIN products p ON sqp.product_id = p.id
            LEFT JOIN LATERAL (
                SELECT * FROM product_price_history
                WHERE product_id = p.id
                ORDER BY created_at DESC
                LIMIT 1
            ) lp ON true
            WHERE sq.query_url_hash = $1
              AND sq.expires_at > NOW()
            GROUP BY sq.id
        `;

        const result = await db.query(query, [urlHash]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            return {
                cached: true,
                queryId: row.query_id,
                searchTerm: row.search_term,
                pageNumber: row.page_number,
                productCount: row.product_count,
                products: row.products,
                cachedAt: row.created_at,
                expiresAt: row.expires_at
            };
        }

        return null;
    }

    /**
     * Get cached product detail
     */
    static async getCachedProduct(url) {
        const urlHash = this.hashUrl(url);

        const query = `
            SELECT 
                p.id,
                p.asin,
                p.name,
                p.product_url,
                p.main_image_url,
                p.metadata,
                p.last_scraped_at,
                s.id as store_id,
                s.name as store_name,
                s.country_code as store_country,
                ph.price,
                ph.original_price,
                ph.currency,
                ph.discount_percent,
                ph.condition,
                ph.availability,
                ph.seller,
                ph.is_prime,
                ph.rating,
                ph.review_count,
                ph.raw_data,
                ph.created_at as price_updated_at
            FROM products p
            JOIN stores s ON p.store_id = s.id
            LEFT JOIN LATERAL (
                SELECT * FROM product_price_history
                WHERE product_id = p.id
                ORDER BY created_at DESC
                LIMIT 1
            ) ph ON true
            WHERE md5(p.product_url) = $1
              AND p.last_scraped_at > NOW() - INTERVAL '${this.CACHE_DURATION_HOURS} hours'
        `;

        const result = await db.query(query, [urlHash]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            return {
                cached: true,
                product: {
                    id: row.id,
                    asin: row.asin,
                    name: row.name,
                    productUrl: row.product_url,
                    mainImage: row.main_image_url,
                    price: parseFloat(row.price) || null,
                    originalPrice: parseFloat(row.original_price) || null,
                    currency: row.currency,
                    discount: row.discount_percent,
                    condition: row.condition || 'new',
                    availability: row.availability,
                    seller: row.seller,
                    isPrime: row.is_prime,
                    rating: parseFloat(row.rating) || null,
                    reviewCount: row.review_count,
                    ...row.raw_data
                },
                store: {
                    id: row.store_id,
                    name: row.store_name,
                    countryCode: row.store_country
                },
                storeName: row.store_name,
                lastScrapedAt: row.last_scraped_at,
                priceUpdatedAt: row.price_updated_at
            };
        }

        return null;
    }

    /**
     * Save search results to cache
     */
    static async saveSearchResults(url, searchTerm, products, userId, storeId) {
        const requestId = `cache-${Date.now()}`;

        try {
            return await db.transaction(async(client) => {
                // Calculate expiration
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + this.CACHE_DURATION_HOURS);

                // Insert or update search query
                const queryResult = await client.query(`
                    INSERT INTO search_queries (store_id, query_url, search_term, page_number, product_count, scraped_by_user_id, expires_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (query_url_hash) DO UPDATE SET
                        product_count = EXCLUDED.product_count,
                        scraped_by_user_id = EXCLUDED.scraped_by_user_id,
                        expires_at = EXCLUDED.expires_at,
                        created_at = CURRENT_TIMESTAMP
                    RETURNING id
                `, [storeId, url, searchTerm, 1, products.length, userId, expiresAt]);

                const queryId = queryResult.rows[0].id;

                // Delete old product associations
                await client.query('DELETE FROM search_query_products WHERE search_query_id = $1', [queryId]);

                // Save each product
                for (let i = 0; i < products.length; i++) {
                    const product = products[i];

                    if (!product.asin) continue;

                    // Upsert product
                    const productResult = await client.query(`
                        INSERT INTO products (asin, store_id, name, product_url, main_image_url, metadata)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (asin, store_id) DO UPDATE SET
                            name = COALESCE(EXCLUDED.name, products.name),
                            product_url = COALESCE(EXCLUDED.product_url, products.product_url),
                            main_image_url = COALESCE(EXCLUDED.main_image_url, products.main_image_url),
                            last_scraped_at = CURRENT_TIMESTAMP,
                            scrape_count = products.scrape_count + 1
                        RETURNING id
                    `, [
                        product.asin,
                        storeId,
                        product.name,
                        product.productUrl,
                        product.imageUrl,
                        JSON.stringify({ features: product.features || [] })
                    ]);

                    const productId = productResult.rows[0].id;

                    // Link product to search query
                    await client.query(`
                        INSERT INTO search_query_products (search_query_id, product_id, position)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (search_query_id, product_id) DO UPDATE SET position = EXCLUDED.position
                    `, [queryId, productId, i + 1]);

                    // Save price history with condition
                    if (product.price !== undefined) {
                        await client.query(`
                            INSERT INTO product_price_history 
                            (product_id, price, original_price, currency, discount_percent, condition, availability, seller, is_prime, rating, review_count, scraped_by_user_id, scrape_source, raw_data)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                        `, [
                            productId,
                            product.price,
                            product.originalPrice,
                            product.currency || 'USD',
                            product.discount,
                            product.condition || 'new',
                            product.availability,
                            product.seller,
                            product.isPrime,
                            product.rating,
                            product.reviewCount,
                            userId,
                            'api',
                            JSON.stringify(product)
                        ]);
                    }
                }

                logger.info(requestId, `Cached ${products.length} products for search query`);
                return { queryId, productCount: products.length };
            });
        } catch (error) {
            logger.error(requestId, 'Failed to save search results', { error: error.message });
            throw error;
        }
    }

    /**
     * Save single product to cache
     */
    static async saveProduct(url, productData, userId, storeId) {
        const requestId = `cache-${Date.now()}`;

        try {
            return await db.transaction(async(client) => {
                // Upsert product
                const productResult = await client.query(`
                    INSERT INTO products (asin, store_id, name, product_url, main_image_url, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (asin, store_id) DO UPDATE SET
                        name = COALESCE(EXCLUDED.name, products.name),
                        product_url = COALESCE(EXCLUDED.product_url, products.product_url),
                        main_image_url = COALESCE(EXCLUDED.main_image_url, products.main_image_url),
                        metadata = products.metadata || EXCLUDED.metadata,
                        last_scraped_at = CURRENT_TIMESTAMP,
                        scrape_count = products.scrape_count + 1
                    RETURNING id
                `, [
                    productData.asin,
                    storeId,
                    productData.name,
                    url,
                    productData.mainImage || productData.images?.[0],
                    JSON.stringify({
                        features: productData.features || [],
                        description: productData.description
                    })
                ]);

                const productId = productResult.rows[0].id;

                // Save price history with condition
                await client.query(`
                    INSERT INTO product_price_history 
                    (product_id, price, original_price, currency, discount_percent, condition, availability, seller, is_prime, rating, review_count, scraped_by_user_id, scrape_source, raw_data)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                `, [
                    productId,
                    productData.price,
                    productData.originalPrice,
                    productData.currency || 'USD',
                    productData.discount,
                    productData.condition || 'new',
                    productData.availability,
                    productData.seller,
                    productData.isPrime,
                    productData.rating,
                    productData.reviewCount,
                    userId,
                    'api',
                    JSON.stringify(productData)
                ]);

                logger.info(requestId, `Cached product ${productData.asin} (${productData.condition || 'new'})`);
                return { productId, asin: productData.asin };
            });
        } catch (error) {
            logger.error(requestId, 'Failed to save product', { error: error.message });
            throw error;
        }
    }

    /**
     * Get product price history
     */
    static async getProductPriceHistory(productId, days = 30) {
        const query = `
            SELECT 
                price,
                original_price,
                currency,
                discount_percent,
                condition,
                availability,
                seller,
                rating,
                review_count,
                created_at
            FROM product_price_history
            WHERE product_id = $1
              AND created_at > NOW() - INTERVAL '${days} days'
            ORDER BY created_at DESC
        `;

        const result = await db.query(query, [productId]);
        return result.rows;
    }

    /**
     * Get product by ASIN (for cross-store comparison)
     */
    static async getProductByAsin(asin) {
        const query = `
            SELECT 
                p.id,
                p.asin,
                p.name,
                p.product_url,
                p.main_image_url,
                s.name as store_name,
                s.base_url as store_url,
                ph.price,
                ph.original_price,
                ph.currency,
                ph.created_at as price_updated_at
            FROM products p
            JOIN stores s ON p.store_id = s.id
            LEFT JOIN LATERAL (
                SELECT * FROM product_price_history
                WHERE product_id = p.id
                ORDER BY created_at DESC
                LIMIT 1
            ) ph ON true
            WHERE p.asin = $1
            ORDER BY ph.created_at DESC
        `;

        const result = await db.query(query, [asin]);
        return result.rows;
    }
}

module.exports = ProductCacheService;

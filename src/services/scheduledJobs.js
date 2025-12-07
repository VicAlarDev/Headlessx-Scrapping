/**
 * Scheduled Jobs Service
 *
 * Manages cron-based scheduled scraping jobs
 */

const cron = require('node-cron');
const db = require('./database');
const { logger } = require('../utils/logger');

class ScheduledJobsService {
    constructor() {
        this.activeJobs = new Map();
        this.isRunning = false;
    }

    /**
     * Initialize the job scheduler
     */
    async initialize() {
        if (this.isRunning) return;

        logger.info('SCHEDULER', 'Initializing scheduled jobs service');

        // Load and schedule all active jobs
        await this.loadActiveJobs();

        // Start the job checker (runs every minute)
        this.jobChecker = cron.schedule('* * * * *', async() => {
            await this.checkAndRunDueJobs();
        });

        this.isRunning = true;
        logger.info('SCHEDULER', 'Scheduled jobs service started');
    }

    /**
     * Load all active jobs from database
     */
    async loadActiveJobs() {
        try {
            const result = await db.query(`
                SELECT * FROM scheduled_jobs WHERE is_active = true
            `);

            for (const job of result.rows) {
                await this.scheduleJob(job);
            }

            logger.info('SCHEDULER', `Loaded ${result.rows.length} active jobs`);
        } catch (error) {
            logger.error('SCHEDULER', 'Failed to load active jobs', { error: error.message });
        }
    }

    /**
     * Schedule a single job
     */
    async scheduleJob(job) {
        // Validate cron expression
        if (!cron.validate(job.cron_expression)) {
            logger.error('SCHEDULER', `Invalid cron expression for job ${job.id}`, {
                expression: job.cron_expression
            });
            return false;
        }

        // Calculate next run time
        const nextRun = this.getNextRunTime(job.cron_expression);

        // Update next_run_at in database
        await db.query(`
            UPDATE scheduled_jobs SET next_run_at = $1 WHERE id = $2
        `, [nextRun, job.id]);

        // Store job info
        this.activeJobs.set(job.id, {
            ...job,
            nextRun
        });

        logger.info('SCHEDULER', `Scheduled job ${job.name}`, {
            jobId: job.id,
            nextRun: nextRun.toISOString()
        });

        return true;
    }

    /**
     * Check and run due jobs
     */
    async checkAndRunDueJobs() {
        try {
            const result = await db.query(`
                SELECT * FROM scheduled_jobs 
                WHERE is_active = true 
                  AND next_run_at <= NOW()
                ORDER BY next_run_at ASC
                LIMIT 10
            `);

            for (const job of result.rows) {
                await this.executeJob(job);
            }
        } catch (error) {
            logger.error('SCHEDULER', 'Error checking due jobs', { error: error.message });
        }
    }

    /**
     * Execute a scheduled job
     */
    async executeJob(job) {
        const executionId = `exec-${Date.now()}`;
        logger.info('SCHEDULER', `Executing job ${job.name}`, { jobId: job.id });

        // Create execution record
        const execResult = await db.query(`
            INSERT INTO job_executions (job_id, status)
            VALUES ($1, 'running')
            RETURNING id
        `, [job.id]);

        const execId = execResult.rows[0].id;
        const startTime = Date.now();

        try {
            let result;

            switch (job.job_type) {
            case 'product_scrape':
                result = await this.executeProductScrape(job);
                break;
            case 'search_scrape':
                result = await this.executeSearchScrape(job);
                break;
            case 'price_monitor':
                result = await this.executePriceMonitor(job);
                break;
            default:
                throw new Error(`Unknown job type: ${job.job_type}`);
            }

            const duration = Date.now() - startTime;

            // Update execution record
            await db.query(`
                UPDATE job_executions 
                SET status = 'completed', completed_at = NOW(), duration_ms = $1, result = $2
                WHERE id = $3
            `, [duration, JSON.stringify(result), execId]);

            // Update job stats
            const nextRun = this.getNextRunTime(job.cron_expression);
            await db.query(`
                UPDATE scheduled_jobs 
                SET last_run_at = NOW(), 
                    next_run_at = $1,
                    run_count = run_count + 1,
                    success_count = success_count + 1,
                    last_error = NULL
                WHERE id = $2
            `, [nextRun, job.id]);

            logger.info('SCHEDULER', `Job ${job.name} completed`, {
                jobId: job.id,
                duration,
                nextRun: nextRun.toISOString()
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;

            // Update execution record
            await db.query(`
                UPDATE job_executions 
                SET status = 'failed', completed_at = NOW(), duration_ms = $1, error_message = $2
                WHERE id = $3
            `, [duration, error.message, execId]);

            // Update job stats
            const nextRun = this.getNextRunTime(job.cron_expression);
            await db.query(`
                UPDATE scheduled_jobs 
                SET last_run_at = NOW(),
                    next_run_at = $1,
                    run_count = run_count + 1,
                    failure_count = failure_count + 1,
                    last_error = $2
                WHERE id = $3
            `, [nextRun, error.message, job.id]);

            logger.error('SCHEDULER', `Job ${job.name} failed`, {
                jobId: job.id,
                error: error.message
            });

            throw error;
        }
    }

    /**
     * Execute product scrape job
     */
    async executeProductScrape(job) {
        // Lazy load to avoid circular dependency
        const AmazonScraperService = require('./stores/amazon');

        const result = await AmazonScraperService.scrapeProductDetail(job.target_url, {
            useAI: job.config?.useAI !== false,
            language: job.config?.language || 'es'
        });

        // Save to cache
        const ProductCacheService = require('./productCache');
        if (result.product?.asin) {
            await ProductCacheService.saveProduct(
                job.target_url,
                result.product,
                job.user_id,
                job.store_id
            );
        }

        return {
            type: 'product_scrape',
            asin: result.product?.asin,
            name: result.product?.name,
            price: result.product?.price
        };
    }

    /**
     * Execute search scrape job
     */
    async executeSearchScrape(job) {
        const AmazonScraperService = require('./stores/amazon');

        const result = await AmazonScraperService.scrapeProductList(job.target_url, {
            useAI: job.config?.useAI !== false,
            maxProducts: job.config?.maxProducts || 50,
            language: job.config?.language || 'es',
            page: job.config?.page || 1
        });

        // Save to cache
        const ProductCacheService = require('./productCache');
        await ProductCacheService.saveSearchResults(
            job.target_url,
            job.config?.searchTerm,
            result.products,
            job.user_id,
            job.store_id
        );

        return {
            type: 'search_scrape',
            productCount: result.productCount,
            url: job.target_url
        };
    }

    /**
     * Execute price monitor job
     */
    async executePriceMonitor(job) {
        const AmazonScraperService = require('./stores/amazon');
        const ProductCacheService = require('./productCache');

        // Get current price
        const result = await AmazonScraperService.scrapeProductDetail(job.target_url, {
            useAI: false,
            language: job.config?.language || 'es'
        });

        if (!result.product?.asin) {
            throw new Error('Could not extract product ASIN');
        }

        // Get previous price
        const history = await ProductCacheService.getProductPriceHistory(
            job.config?.productId,
            1
        );

        const previousPrice = history[0]?.price;
        const currentPrice = result.product.price;

        // Save new price
        await ProductCacheService.saveProduct(
            job.target_url,
            result.product,
            job.user_id,
            job.store_id
        );

        // Check for price alerts
        if (previousPrice && currentPrice && previousPrice !== currentPrice) {
            await this.checkPriceAlerts(job.config?.productId, currentPrice, previousPrice);
        }

        return {
            type: 'price_monitor',
            asin: result.product.asin,
            previousPrice,
            currentPrice,
            priceChanged: previousPrice !== currentPrice
        };
    }

    /**
     * Check and trigger price alerts
     */
    async checkPriceAlerts(productId, currentPrice, previousPrice) {
        const alerts = await db.query(`
            SELECT pa.*, u.email
            FROM price_alerts pa
            JOIN users u ON pa.user_id = u.id
            WHERE pa.product_id = $1 AND pa.is_active = true
        `, [productId]);

        for (const alert of alerts.rows) {
            let shouldTrigger = false;

            switch (alert.alert_type) {
            case 'price_drop':
                shouldTrigger = currentPrice < previousPrice;
                break;
            case 'price_below':
                shouldTrigger = currentPrice <= alert.target_price;
                break;
            case 'price_above':
                shouldTrigger = currentPrice >= alert.target_price;
                break;
            }

            if (shouldTrigger) {
                await db.query(`
                    UPDATE price_alerts 
                    SET last_triggered_at = NOW(), trigger_count = trigger_count + 1
                    WHERE id = $1
                `, [alert.id]);

                logger.info('SCHEDULER', `Price alert triggered for user ${alert.email}`, {
                    alertId: alert.id,
                    productId,
                    currentPrice,
                    previousPrice
                });

                // TODO: Send notification (email, webhook, etc.)
            }
        }
    }

    /**
     * Get next run time from cron expression
     */
    getNextRunTime(cronExpression) {
        const interval = cron.schedule(cronExpression, () => {}, { scheduled: false });
        // Get next occurrence
        const now = new Date();
        const parts = cronExpression.split(' ');

        // Simple calculation for next run
        const nextRun = new Date(now);
        nextRun.setSeconds(0);
        nextRun.setMilliseconds(0);

        // Add 1 minute minimum
        nextRun.setMinutes(nextRun.getMinutes() + 1);

        return nextRun;
    }

    /**
     * Create a new scheduled job
     */
    static async createJob(userId, jobData) {
        const {
            name,
            jobType,
            targetUrl,
            targetAsin,
            storeId,
            cronExpression,
            timezone = 'UTC',
            config = {}
        } = jobData;

        // Validate cron expression
        if (!cron.validate(cronExpression)) {
            throw new Error('Invalid cron expression');
        }

        const result = await db.query(`
            INSERT INTO scheduled_jobs 
            (user_id, name, job_type, target_url, target_asin, store_id, cron_expression, timezone, config)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [userId, name, jobType, targetUrl, targetAsin, storeId, cronExpression, timezone, JSON.stringify(config)]);

        return result.rows[0];
    }

    /**
     * Update a scheduled job
     */
    static async updateJob(jobId, userId, updates) {
        const allowedFields = ['name', 'cron_expression', 'timezone', 'is_active', 'config'];
        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(updates)) {
            const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (allowedFields.includes(dbKey)) {
                setClauses.push(`${dbKey} = $${paramIndex}`);
                values.push(key === 'config' ? JSON.stringify(value) : value);
                paramIndex++;
            }
        }

        if (setClauses.length === 0) {
            throw new Error('No valid fields to update');
        }

        values.push(jobId, userId);

        const result = await db.query(`
            UPDATE scheduled_jobs 
            SET ${setClauses.join(', ')}
            WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
            RETURNING *
        `, values);

        return result.rows[0];
    }

    /**
     * Delete a scheduled job
     */
    static async deleteJob(jobId, userId) {
        const result = await db.query(`
            DELETE FROM scheduled_jobs 
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `, [jobId, userId]);

        return result.rows.length > 0;
    }

    /**
     * Get user's scheduled jobs
     */
    static async getUserJobs(userId, options = {}) {
        const { limit = 50, offset = 0, isActive } = options;

        let query = `
            SELECT sj.*, s.name as store_name
            FROM scheduled_jobs sj
            LEFT JOIN stores s ON sj.store_id = s.id
            WHERE sj.user_id = $1
        `;
        const params = [userId];

        if (isActive !== undefined) {
            query += ` AND sj.is_active = $2`;
            params.push(isActive);
        }

        query += ` ORDER BY sj.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        return result.rows;
    }

    /**
     * Get job execution history
     */
    static async getJobExecutions(jobId, userId, limit = 20) {
        const result = await db.query(`
            SELECT je.*
            FROM job_executions je
            JOIN scheduled_jobs sj ON je.job_id = sj.id
            WHERE je.job_id = $1 AND sj.user_id = $2
            ORDER BY je.created_at DESC
            LIMIT $3
        `, [jobId, userId, limit]);

        return result.rows;
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.jobChecker) {
            this.jobChecker.stop();
        }
        this.activeJobs.clear();
        this.isRunning = false;
        logger.info('SCHEDULER', 'Scheduled jobs service stopped');
    }
}

// Singleton instance
const scheduledJobsService = new ScheduledJobsService();

module.exports = {
    ScheduledJobsService,
    scheduledJobsService
};

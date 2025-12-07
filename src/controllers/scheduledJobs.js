/**
 * Scheduled Jobs Controller
 * Handles CRUD operations for user scheduled jobs
 */

const { ScheduledJobsService } = require('../services/scheduledJobs');
const { logger } = require('../utils/logger');
const { createErrorResponse } = require('../utils/errors');

class ScheduledJobsController {
    /**
     * Create a new scheduled job
     * POST /api/jobs
     */
    static async createJob(req, res) {
        const requestId = req.requestId;

        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
            }

            const { name, jobType, targetUrl, targetAsin, storeId, cronExpression, timezone, config } = req.body;

            // Validate required fields
            if (!name || !jobType || !targetUrl || !cronExpression) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: name, jobType, targetUrl, cronExpression'
                });
            }

            // Validate job type
            const validTypes = ['product_scrape', 'search_scrape', 'price_monitor'];
            if (!validTypes.includes(jobType)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid job type. Must be one of: ${validTypes.join(', ')}`
                });
            }

            logger.info(requestId, `Creating scheduled job: ${name}`);

            const job = await ScheduledJobsService.createJob(userId, {
                name,
                jobType,
                targetUrl,
                targetAsin,
                storeId: storeId || 1,
                cronExpression,
                timezone: timezone || 'UTC',
                config: config || {}
            });

            res.status(201).json({
                success: true,
                job,
                message: 'Scheduled job created successfully'
            });
        } catch (error) {
            logger.error(requestId, 'Create job error', error);
            const { statusCode, errorResponse } = createErrorResponse(error);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get user's scheduled jobs
     * GET /api/jobs
     */
    static async getJobs(req, res) {
        const requestId = req.requestId;

        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
            }

            const { limit, offset, active } = req.query;

            const jobs = await ScheduledJobsService.getUserJobs(userId, {
                limit: parseInt(limit || '50', 10),
                offset: parseInt(offset || '0', 10),
                isActive: active === 'true' ? true : active === 'false' ? false : undefined
            });

            res.json({
                success: true,
                jobs,
                count: jobs.length
            });
        } catch (error) {
            logger.error(requestId, 'Get jobs error', error);
            const { statusCode, errorResponse } = createErrorResponse(error);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Update a scheduled job
     * PUT /api/jobs/:id
     */
    static async updateJob(req, res) {
        const requestId = req.requestId;

        try {
            const userId = req.user?.id;
            const jobId = req.params.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
            }

            logger.info(requestId, `Updating scheduled job: ${jobId}`);

            const job = await ScheduledJobsService.updateJob(jobId, userId, req.body);

            if (!job) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found or access denied'
                });
            }

            res.json({
                success: true,
                job,
                message: 'Job updated successfully'
            });
        } catch (error) {
            logger.error(requestId, 'Update job error', error);
            const { statusCode, errorResponse } = createErrorResponse(error);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Delete a scheduled job
     * DELETE /api/jobs/:id
     */
    static async deleteJob(req, res) {
        const requestId = req.requestId;

        try {
            const userId = req.user?.id;
            const jobId = req.params.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
            }

            logger.info(requestId, `Deleting scheduled job: ${jobId}`);

            const deleted = await ScheduledJobsService.deleteJob(jobId, userId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found or access denied'
                });
            }

            res.json({
                success: true,
                message: 'Job deleted successfully'
            });
        } catch (error) {
            logger.error(requestId, 'Delete job error', error);
            const { statusCode, errorResponse } = createErrorResponse(error);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Get job execution history
     * GET /api/jobs/:id/executions
     */
    static async getJobExecutions(req, res) {
        const requestId = req.requestId;

        try {
            const userId = req.user?.id;
            const jobId = req.params.id;
            const limit = parseInt(req.query.limit || '20', 10);

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
            }

            const executions = await ScheduledJobsService.getJobExecutions(jobId, userId, limit);

            res.json({
                success: true,
                jobId,
                executions,
                count: executions.length
            });
        } catch (error) {
            logger.error(requestId, 'Get job executions error', error);
            const { statusCode, errorResponse } = createErrorResponse(error);
            res.status(statusCode).json(errorResponse);
        }
    }

    /**
     * Manually trigger a job
     * POST /api/jobs/:id/run
     */
    static async runJob(req, res) {
        const requestId = req.requestId;

        try {
            const userId = req.user?.id;
            const jobId = req.params.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User authentication required'
                });
            }

            logger.info(requestId, `Manually triggering job: ${jobId}`);

            // Get job details
            const db = require('../services/database');
            const result = await db.query(`
                SELECT * FROM scheduled_jobs WHERE id = $1 AND user_id = $2
            `, [jobId, userId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found or access denied'
                });
            }

            const job = result.rows[0];

            // Execute the job
            const { scheduledJobsService } = require('../services/scheduledJobs');
            const execResult = await scheduledJobsService.executeJob(job);

            res.json({
                success: true,
                message: 'Job executed successfully',
                result: execResult
            });
        } catch (error) {
            logger.error(requestId, 'Run job error', error);
            const { statusCode, errorResponse } = createErrorResponse(error);
            res.status(statusCode).json(errorResponse);
        }
    }
}

module.exports = ScheduledJobsController;

/**
 * Scheduled Jobs Routes
 * CRUD operations for user scheduled scraping jobs
 */

const express = require('express');
const router = express.Router();

const ScheduledJobsController = require('../controllers/scheduledJobs');
const { authenticateApiKey } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');

// All routes require API key authentication
router.use(authenticateApiKey);

// Create a new scheduled job
router.post('/', asyncHandler(ScheduledJobsController.createJob));

// Get user's scheduled jobs
router.get('/', asyncHandler(ScheduledJobsController.getJobs));

// Update a scheduled job
router.put('/:id', asyncHandler(ScheduledJobsController.updateJob));

// Delete a scheduled job
router.delete('/:id', asyncHandler(ScheduledJobsController.deleteJob));

// Get job execution history
router.get('/:id/executions', asyncHandler(ScheduledJobsController.getJobExecutions));

// Manually trigger a job
router.post('/:id/run', asyncHandler(ScheduledJobsController.runJob));

module.exports = router;

/**
 * Database Service - PostgreSQL Connection and Query Management
 *
 * Handles connection pooling, queries, and transactions
 */

const { Pool } = require('pg');
const { logger } = require('../utils/logger');

class DatabaseService {
    constructor() {
        this.pool = null;
        this.isConnected = false;
    }

    /**
     * Initialize database connection pool
     */
    async initialize() {
        if (this.pool) {
            return this.pool;
        }

        const config = {
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
            database: process.env.POSTGRES_DB || 'headlessx',
            user: process.env.POSTGRES_USER || 'headlessx',
            password: process.env.POSTGRES_PASSWORD || 'headlessx_secret',
            max: parseInt(process.env.POSTGRES_POOL_SIZE || '20', 10),
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        };

        try {
            this.pool = new Pool(config);

            // Test connection
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();

            this.isConnected = true;
            logger.info('DATABASE', 'PostgreSQL connection pool initialized');

            // Handle pool errors
            this.pool.on('error', (err) => {
                logger.error('DATABASE', 'Unexpected pool error', { error: err.message });
            });

            return this.pool;
        } catch (error) {
            logger.error('DATABASE', 'Failed to initialize database', { error: error.message });
            this.isConnected = false;
            throw error;
        }
    }

    /**
     * Get connection pool
     */
    getPool() {
        if (!this.pool) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        return this.pool;
    }

    /**
     * Execute a query
     */
    async query(text, params = []) {
        if (!this.pool) {
            await this.initialize();
        }

        const start = Date.now();
        try {
            const result = await this.pool.query(text, params);
            const duration = Date.now() - start;

            if (duration > 1000) {
                logger.warn('DATABASE', 'Slow query detected', { duration, text: text.substring(0, 100) });
            }

            return result;
        } catch (error) {
            logger.error('DATABASE', 'Query error', { error: error.message, query: text.substring(0, 100) });
            throw error;
        }
    }

    /**
     * Execute a transaction
     */
    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Check if database is connected
     */
    async healthCheck() {
        try {
            const result = await this.query('SELECT NOW() as time, current_database() as database');
            return {
                connected: true,
                database: result.rows[0].database,
                timestamp: result.rows[0].time
            };
        } catch (error) {
            return {
                connected: false,
                error: error.message
            };
        }
    }

    /**
     * Close all connections
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.isConnected = false;
            logger.info('DATABASE', 'Connection pool closed');
        }
    }
}

// Singleton instance
const databaseService = new DatabaseService();

module.exports = databaseService;

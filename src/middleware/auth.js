/**
 * Authentication Middleware
 * Token-based and API Key authentication for API endpoints
 */

const config = require('../config');
const { logger, generateRequestId } = require('../utils/logger');
const crypto = require('crypto');

// Database service (lazy loaded to avoid circular dependency)
let db = null;
const getDb = () => {
    if (!db) {
        db = require('../services/database');
    }
    return db;
};

// Secure token comparison to prevent timing attacks
function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }

    if (a.length !== b.length) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Legacy token authentication middleware
function authenticate(req, res, next) {
    const requestId = generateRequestId();
    req.requestId = requestId;

    // Extract token from various sources
    const token = req.query.token ||
                  req.headers['x-token'] ||
                  req.headers.authorization?.replace('Bearer ', '');

    if (!secureCompare(token || '', config.server.authToken || '')) {
        logger.warn(requestId, 'Authentication failed', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path
        });
        return res.status(401).json({
            error: 'Unauthorized: Invalid token',
            timestamp: new Date().toISOString()
        });
    }

    logger.info(requestId, 'Authentication successful', {
        ip: req.ip,
        path: req.path,
        method: req.method
    });

    next();
}

/**
 * API Key authentication middleware
 * Authenticates users via API key and attaches user info to request
 */
async function authenticateApiKey(req, res, next) {
    const requestId = generateRequestId();
    req.requestId = requestId;

    // Extract API key from headers
    const apiKey = req.headers['x-api-key'] ||
                   req.headers.authorization?.replace('Bearer ', '');

    if (!apiKey) {
        logger.warn(requestId, 'No API key provided', {
            ip: req.ip,
            path: req.path
        });
        return res.status(401).json({
            error: 'Unauthorized: API key required',
            timestamp: new Date().toISOString()
        });
    }

    try {
        const database = getDb();

        // Check if database is connected
        if (!database.isConnected) {
            // Fallback to legacy token auth
            if (secureCompare(apiKey, config.server.authToken || '')) {
                req.user = { id: null, role: 'legacy', apiKey };
                return next();
            }
            return res.status(401).json({
                error: 'Unauthorized: Invalid API key',
                timestamp: new Date().toISOString()
            });
        }

        // Look up user by API key
        const result = await database.query(`
            SELECT id, email, name, role, settings, rate_limit_per_hour, is_active
            FROM users
            WHERE api_key = $1 AND is_active = true
        `, [apiKey]);

        if (result.rows.length === 0) {
            // Try legacy token as fallback
            if (secureCompare(apiKey, config.server.authToken || '')) {
                req.user = { id: null, role: 'legacy', apiKey };
                return next();
            }

            logger.warn(requestId, 'Invalid API key', {
                ip: req.ip,
                path: req.path
            });
            return res.status(401).json({
                error: 'Unauthorized: Invalid API key',
                timestamp: new Date().toISOString()
            });
        }

        const user = result.rows[0];

        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            settings: user.settings,
            rateLimitPerHour: user.rate_limit_per_hour
        };

        // Update last login
        database.query(`
            UPDATE users SET last_login_at = NOW() WHERE id = $1
        `, [user.id]).catch(() => {}); // Fire and forget

        logger.info(requestId, 'API key authentication successful', {
            userId: user.id,
            email: user.email,
            path: req.path
        });

        next();
    } catch (error) {
        logger.error(requestId, 'API key authentication error', { error: error.message });

        // Fallback to legacy token
        if (secureCompare(apiKey, config.server.authToken || '')) {
            req.user = { id: null, role: 'legacy', apiKey };
            return next();
        }

        return res.status(500).json({
            error: 'Authentication service error',
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Optional API key authentication
 * Attaches user if API key is valid, but doesn't require it
 */
async function optionalAuth(req, res, next) {
    const requestId = generateRequestId();
    req.requestId = requestId;

    const apiKey = req.headers['x-api-key'] ||
                   req.headers.authorization?.replace('Bearer ', '');

    if (!apiKey) {
        req.user = null;
        return next();
    }

    try {
        const database = getDb();

        if (!database.isConnected) {
            req.user = null;
            return next();
        }

        const result = await database.query(`
            SELECT id, email, name, role, settings
            FROM users
            WHERE api_key = $1 AND is_active = true
        `, [apiKey]);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            req.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                settings: user.settings
            };
        } else {
            req.user = null;
        }
    } catch (error) {
        req.user = null;
    }

    next();
}

/**
 * Admin role check middleware
 */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Forbidden: Admin access required',
            timestamp: new Date().toISOString()
        });
    }
    next();
}

// Authentication middleware for text responses
function authenticateText(req, res, next) {
    const requestId = generateRequestId();
    req.requestId = requestId;

    const token = req.query.token ||
                  req.headers['x-token'] ||
                  req.headers.authorization?.replace('Bearer ', '');

    if (!secureCompare(token || '', config.server.authToken || '')) {
        logger.warn(requestId, 'Authentication failed (text endpoint)', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path
        });
        return res.status(401).send('Unauthorized: Invalid token');
    }

    logger.info(requestId, 'Authentication successful (text endpoint)', {
        ip: req.ip,
        path: req.path,
        method: req.method
    });

    next();
}

// Request ID middleware (for endpoints that don't require auth)
function addRequestId(req, res, next) {
    if (!req.requestId) {
        req.requestId = generateRequestId();
    }
    next();
}

module.exports = {
    authenticate,
    authenticateApiKey,
    authenticateText,
    optionalAuth,
    requireAdmin,
    addRequestId
};

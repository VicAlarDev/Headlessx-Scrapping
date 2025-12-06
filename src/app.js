/**
 * HeadlessX v1.3.0 - Enhanced Main Application Entry Point
 *
 * Production-ready modular server with advanced anti-detection capabilities
 * Optimized for both direct execution and PM2 deployment
 *
 * New v1.3.0 Features:
 * - Advanced fingerprinting control
 * - Behavioral simulation engine
 * - WAF bypass capabilities
 * - Enhanced monitoring and testing
 */

const express = require('express');
const path = require('path');

// Core modules with error handling
let config, browserService, logger;

try {
    config = require('./config');
    browserService = require('./services/browser');
    logger = require('./utils/logger').logger;

    // v1.3.0: Validate anti-detection configuration
    if (config.antiDetection.stealthMode === 'maximum') {
        logger.info('🛡️ Maximum stealth mode activated');
    }
} catch (error) {
    console.error('❌ Failed to load core modules:', error.message);
    process.exit(1);
}

// Import enhanced routes (v1.3.0)
const apiRoutes = require('./routes/api');
const ecommerceRoutes = require('./routes/ecommerce');
const amazonRoutes = require('./routes/stores/amazon');
const staticRoutes = require('./routes/static');
let adminRoutes = null;
if (config.features?.adminRoutes) {
    try {
        adminRoutes = require('./routes/admin');
    } catch (error) {
        logger?.warn?.('app_init', 'Admin routes disabled due to load error', { message: error.message });
        adminRoutes = null;
    }
}

// Import enhanced middleware (v1.3.0)
const { errorHandler, notFoundHandler } = require('./middleware/error');
const { apiLimiter, requestAnalyzer } = require('./middleware/rate-limiter');
const { analyzeRequest } = require('./middleware/request-analyzer');

// Create Express application
const app = express();

// Basic middleware (essential only)
app.use(express.json({ limit: config.api.bodyLimit || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: config.api.bodyLimit || '10mb' }));

// v1.3.0: Enhanced request analysis and rate limiting
if (config.features?.requestAnalyzerEnabled === false) {
    logger?.info?.('app_init', 'Request analyzer disabled for current environment');
} else {
    app.use(analyzeRequest);
}

if (config.features?.rateLimiterEnabled === false) {
    logger?.info?.('app_init', 'API rate limiter disabled for current environment');
} else {
    app.use(apiLimiter);
}

// CORS middleware
if (config.security.corsEnabled) {
    const cors = require('cors');
    app.use(cors({
        origin: config.security.allowedOrigins.includes('*') ? true : config.security.allowedOrigins,
        credentials: true
    }));
}

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Mount API routes
app.use('/api', apiRoutes);

// Mount E-commerce routes
app.use('/api/ecommerce', ecommerceRoutes);

// Mount store-specific routes
app.use('/api/amazon', amazonRoutes);

// Mount admin routes (v1.3.0)
if (adminRoutes) {
    app.use('/admin', adminRoutes);
} else {
    logger?.info?.('app_init', 'Admin routes disabled', { featureFlag: 'ENABLE_ADMIN_ROUTES' });
}

// Mount static routes (if available)
try {
    app.use('/', staticRoutes);
} catch (error) {
    console.log('⚠️ Static routes not available');
}

// Serve website files if available
const websitePath = path.join(__dirname, '..', 'website', 'out');
try {
    const fs = require('fs');
    if (fs.existsSync(websitePath)) {
        console.log(`🌐 Website served from: ${websitePath}`);
        app.use(express.static(websitePath, { index: 'index.html' }));

        // SPA fallback
        app.get('*', (req, res, next) => {
            if (req.path.startsWith('/api/')) {
                next();
            } else {
                res.sendFile(path.join(websitePath, 'index.html'), (err) => {
                    if (err) next();
                });
            }
        });
    } else {
        console.log(`⚠️ Website not found at: ${websitePath}`);
        app.get('/', (req, res) => {
            res.json({
                message: 'HeadlessX v1.2.0 - Advanced Browserless Web Scraping API',
                status: 'Website not built',
                api: {
                    health: '/api/health',
                    status: '/api/status',
                    docs: '/api/docs'
                },
                note: 'Run "npm run build" to build the website'
            });
        });
    }
} catch (error) {
    console.log(`⚠️ Website setup error: ${error.message}`);
}

// 404 handler for API routes
app.use('/api/*', notFoundHandler);

// Global error handler
app.use(errorHandler);

// Server instance
let server;

// Graceful shutdown
async function gracefulShutdown(signal) {
    console.log(`🛑 Received ${signal}, shutting down gracefully...`);

    try {
        if (browserService) {
            await browserService.shutdown();
            console.log('✅ Browser service closed');
        }

        if (server) {
            server.close(() => {
                console.log('✅ HTTP server closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
}

// Signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});

// Start server with v1.3.0 enhancements
function startServer() {
    const port = config.server.port || 3000;
    const host = config.server.host || '0.0.0.0';

    server = app.listen(port, host, () => {
        console.log(`🚀 HeadlessX v1.3.0 running on http://${host}:${port}`);
        console.log(`📍 Health check: http://${host}:${port}/api/health`);
        console.log(`📊 Status: http://${host}:${port}/api/status`);
        console.log(`📖 API docs: http://${host}:${port}/api/docs`);

        // v1.3.0 Enhanced status information
        console.log(`🛡️ Stealth mode: ${config.antiDetection.stealthMode}`);
        console.log(`🎭 Fingerprint profile: ${config.antiDetection.fingerprintProfile}`);
        console.log(`🤖 Behavioral simulation: ${config.antiDetection.behavioralSimulation ? 'Enabled' : 'Disabled'}`);
        console.log(`🔐 Auth tokens: ${config.server.authToken ? 'Configured' : 'Missing'}`);

        // v1.3.0 New endpoints
        console.log(`🧪 Fingerprint testing: http://${host}:${port}/api/test-fingerprint`);
        console.log(`👥 Device profiles: http://${host}:${port}/api/profiles`);
        console.log(`🛡️ Stealth status: http://${host}:${port}/api/stealth/status`);

        console.log('✅ v1.3.0 Server ready with advanced anti-detection capabilities');
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${port} is already in use`);
        } else {
            console.error('❌ Server error:', error);
        }
        process.exit(1);
    });
}

// Initialize server with v1.3.0 banner
if (require.main === module || (require.main && require.main.filename.includes('server.js'))) {
    console.log('🔄 Initializing HeadlessX v1.3.0...');
    console.log('🚀 Loading enhanced anti-detection capabilities...');

    // v1.3.0: Initialize performance monitoring if enabled
    if (config.performance.monitoring) {
        console.log('📊 Performance monitoring enabled');
    }

    // v1.3.0: Initialize development tools if enabled
    if (config.development.devToolsEnabled) {
        console.log('🛠️ Development tools enabled');
    }

    setTimeout(() => {
        try {
            startServer();
        } catch (error) {
            console.error('❌ v1.3.0 Server startup failed:', error);
            process.exit(1);
        }
    }, 100);
}

module.exports = app;

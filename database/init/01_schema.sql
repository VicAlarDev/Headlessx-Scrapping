-- HeadlessX Database Schema
-- PostgreSQL 16+

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'premium')),
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}',
    rate_limit_per_hour INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- Index for API key lookups
CREATE INDEX idx_users_api_key ON users(api_key) WHERE is_active = true;
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- STORES TABLE (Amazon, eBay, etc.)
-- ============================================
CREATE TABLE stores (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    base_url VARCHAR(255) NOT NULL,
    country_code VARCHAR(10),
    is_active BOOLEAN DEFAULT true,
    scrape_config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default stores
INSERT INTO stores (name, base_url, country_code) VALUES
    ('amazon_us', 'https://www.amazon.com', 'US'),
    ('amazon_es', 'https://www.amazon.es', 'ES'),
    ('amazon_mx', 'https://www.amazon.com.mx', 'MX'),
    ('amazon_uk', 'https://www.amazon.co.uk', 'UK'),
    ('amazon_de', 'https://www.amazon.de', 'DE'),
    ('amazon_fr', 'https://www.amazon.fr', 'FR'),
    ('amazon_it', 'https://www.amazon.it', 'IT'),
    ('amazon_ca', 'https://www.amazon.ca', 'CA'),
    ('amazon_jp', 'https://www.amazon.co.jp', 'JP'),
    ('amazon_br', 'https://www.amazon.com.br', 'BR'),
    ('amazon_au', 'https://www.amazon.com.au', 'AU'),
    ('amazon_in', 'https://www.amazon.in', 'IN'),
    ('amazon_nl', 'https://www.amazon.nl', 'NL'),
    ('amazon_se', 'https://www.amazon.se', 'SE'),
    ('amazon_pl', 'https://www.amazon.pl', 'PL'),
    ('amazon_ae', 'https://www.amazon.ae', 'AE'),
    ('amazon_sa', 'https://www.amazon.sa', 'SA'),
    ('amazon_sg', 'https://www.amazon.sg', 'SG');

-- ============================================
-- PRODUCTS TABLE (Unique products by ASIN)
-- ============================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asin VARCHAR(20) NOT NULL,
    store_id INTEGER REFERENCES stores(id),
    name VARCHAR(1000),
    brand VARCHAR(255),
    category VARCHAR(255),
    main_image_url TEXT,
    product_url TEXT NOT NULL,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_scraped_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    scrape_count INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint: same ASIN per store
    CONSTRAINT unique_asin_per_store UNIQUE (asin, store_id)
);

-- Indexes for product lookups
CREATE INDEX idx_products_asin ON products(asin);
CREATE INDEX idx_products_store ON products(store_id);
CREATE INDEX idx_products_last_scraped ON products(last_scraped_at);
CREATE INDEX idx_products_url_hash ON products(md5(product_url));

-- ============================================
-- PRODUCT PRICE HISTORY TABLE
-- ============================================
CREATE TABLE product_price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price DECIMAL(12, 2),
    original_price DECIMAL(12, 2),
    currency VARCHAR(10) DEFAULT 'USD',
    discount_percent INTEGER,
    condition VARCHAR(50) DEFAULT 'new', -- new, used, renewed, refurbished
    availability VARCHAR(255),
    seller VARCHAR(255),
    is_prime BOOLEAN,
    rating DECIMAL(3, 2),
    review_count INTEGER,
    scraped_by_user_id UUID REFERENCES users(id),
    scrape_source VARCHAR(50) DEFAULT 'manual', -- manual, scheduled, api
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for price history
CREATE INDEX idx_price_history_product ON product_price_history(product_id);
CREATE INDEX idx_price_history_created ON product_price_history(created_at DESC);
CREATE INDEX idx_price_history_product_date ON product_price_history(product_id, created_at DESC);

-- ============================================
-- SEARCH QUERIES TABLE (Cached search results)
-- ============================================
CREATE TABLE search_queries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id INTEGER REFERENCES stores(id),
    query_url TEXT NOT NULL,
    query_url_hash VARCHAR(32) GENERATED ALWAYS AS (md5(query_url)) STORED,
    search_term VARCHAR(500),
    page_number INTEGER DEFAULT 1,
    product_count INTEGER,
    scraped_by_user_id UUID REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint for URL hash
    CONSTRAINT unique_query_url UNIQUE (query_url_hash)
);

-- Index for query lookups
CREATE INDEX idx_search_queries_hash ON search_queries(query_url_hash);
CREATE INDEX idx_search_queries_expires ON search_queries(expires_at);

-- ============================================
-- SEARCH QUERY PRODUCTS (Many-to-Many)
-- ============================================
CREATE TABLE search_query_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    search_query_id UUID NOT NULL REFERENCES search_queries(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    position INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_query_product UNIQUE (search_query_id, product_id)
);

CREATE INDEX idx_search_query_products_query ON search_query_products(search_query_id);
CREATE INDEX idx_search_query_products_product ON search_query_products(product_id);

-- ============================================
-- SCHEDULED JOBS TABLE
-- ============================================
CREATE TABLE scheduled_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('product_scrape', 'search_scrape', 'price_monitor')),
    target_url TEXT NOT NULL,
    target_asin VARCHAR(20),
    store_id INTEGER REFERENCES stores(id),
    cron_expression VARCHAR(100) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    run_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_error TEXT,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for scheduled jobs
CREATE INDEX idx_scheduled_jobs_user ON scheduled_jobs(user_id);
CREATE INDEX idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at) WHERE is_active = true;
CREATE INDEX idx_scheduled_jobs_type ON scheduled_jobs(job_type);

-- ============================================
-- JOB EXECUTION HISTORY TABLE
-- ============================================
CREATE TABLE job_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for job execution lookups
CREATE INDEX idx_job_executions_job ON job_executions(job_id);
CREATE INDEX idx_job_executions_status ON job_executions(status);
CREATE INDEX idx_job_executions_started ON job_executions(started_at DESC);

-- ============================================
-- PRICE ALERTS TABLE
-- ============================================
CREATE TABLE price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('price_drop', 'price_below', 'price_above', 'back_in_stock')),
    target_price DECIMAL(12, 2),
    threshold_percent INTEGER,
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    trigger_count INTEGER DEFAULT 0,
    notification_config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for price alerts
CREATE INDEX idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX idx_price_alerts_product ON price_alerts(product_id);
CREATE INDEX idx_price_alerts_active ON price_alerts(is_active) WHERE is_active = true;

-- ============================================
-- API REQUEST LOGS TABLE
-- ============================================
CREATE TABLE api_request_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    request_url TEXT,
    response_status INTEGER,
    response_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for API logs (with partitioning consideration)
CREATE INDEX idx_api_logs_user ON api_request_logs(user_id);
CREATE INDEX idx_api_logs_created ON api_request_logs(created_at DESC);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduled_jobs_updated_at BEFORE UPDATE ON scheduled_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_price_alerts_updated_at BEFORE UPDATE ON price_alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to check if a URL was scraped within the cache period
CREATE OR REPLACE FUNCTION is_cache_valid(
    p_url_hash VARCHAR(32),
    p_cache_hours INTEGER DEFAULT 24
)
RETURNS BOOLEAN AS $$
DECLARE
    v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT expires_at INTO v_expires_at
    FROM search_queries
    WHERE query_url_hash = p_url_hash;
    
    IF v_expires_at IS NULL THEN
        RETURN FALSE;
    END IF;
    
    RETURN v_expires_at > CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create a product by ASIN
CREATE OR REPLACE FUNCTION upsert_product(
    p_asin VARCHAR(20),
    p_store_id INTEGER,
    p_name VARCHAR(1000),
    p_product_url TEXT,
    p_main_image_url TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_product_id UUID;
BEGIN
    -- Try to find existing product
    SELECT id INTO v_product_id
    FROM products
    WHERE asin = p_asin AND store_id = p_store_id;
    
    IF v_product_id IS NOT NULL THEN
        -- Update existing product
        UPDATE products
        SET name = COALESCE(p_name, name),
            product_url = COALESCE(p_product_url, product_url),
            main_image_url = COALESCE(p_main_image_url, main_image_url),
            metadata = metadata || p_metadata,
            last_scraped_at = CURRENT_TIMESTAMP,
            scrape_count = scrape_count + 1
        WHERE id = v_product_id;
    ELSE
        -- Insert new product
        INSERT INTO products (asin, store_id, name, product_url, main_image_url, metadata)
        VALUES (p_asin, p_store_id, p_name, p_product_url, p_main_image_url, p_metadata)
        RETURNING id INTO v_product_id;
    END IF;
    
    RETURN v_product_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS
-- ============================================

-- View for latest product prices
CREATE VIEW v_latest_product_prices AS
SELECT DISTINCT ON (p.id)
    p.id AS product_id,
    p.asin,
    p.name,
    p.product_url,
    s.name AS store_name,
    ph.price,
    ph.original_price,
    ph.currency,
    ph.discount_percent,
    ph.availability,
    ph.rating,
    ph.review_count,
    ph.created_at AS price_updated_at,
    p.last_scraped_at
FROM products p
JOIN stores s ON p.store_id = s.id
LEFT JOIN product_price_history ph ON p.id = ph.product_id
ORDER BY p.id, ph.created_at DESC;

-- View for price trends (last 30 days)
CREATE VIEW v_price_trends AS
SELECT
    p.id AS product_id,
    p.asin,
    p.name,
    s.name AS store_name,
    ph.price,
    ph.created_at AS recorded_at,
    LAG(ph.price) OVER (PARTITION BY p.id ORDER BY ph.created_at) AS previous_price,
    ph.price - LAG(ph.price) OVER (PARTITION BY p.id ORDER BY ph.created_at) AS price_change
FROM products p
JOIN stores s ON p.store_id = s.id
JOIN product_price_history ph ON p.id = ph.product_id
WHERE ph.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
ORDER BY p.id, ph.created_at DESC;

-- ============================================
-- DEFAULT ADMIN USER
-- ============================================
INSERT INTO users (email, password_hash, name, role, api_key)
VALUES (
    'admin@headlessx.local',
    crypt('admin123', gen_salt('bf')),
    'Admin User',
    'admin',
    'hx_admin_' || encode(gen_random_bytes(24), 'hex')
);

COMMENT ON TABLE users IS 'User accounts with API keys and settings';
COMMENT ON TABLE products IS 'Unique products identified by ASIN per store';
COMMENT ON TABLE product_price_history IS 'Historical price records for products';
COMMENT ON TABLE search_queries IS 'Cached search query results';
COMMENT ON TABLE scheduled_jobs IS 'User-configured scheduled scraping jobs';
COMMENT ON TABLE price_alerts IS 'Price monitoring alerts for users';

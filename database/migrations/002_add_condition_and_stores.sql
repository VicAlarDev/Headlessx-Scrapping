-- Migration: 002_add_condition_and_stores
-- Description: Add product condition field and additional Amazon stores
-- Date: 2025-12-07

-- ============================================
-- ADD CONDITION FIELD TO PRODUCT_PRICE_HISTORY
-- ============================================
ALTER TABLE product_price_history 
ADD COLUMN IF NOT EXISTS condition VARCHAR(50) DEFAULT 'new';

COMMENT ON COLUMN product_price_history.condition IS 'Product condition: new, used, renewed, refurbished';

-- ============================================
-- ADD NEW AMAZON STORES
-- ============================================
INSERT INTO stores (name, base_url, country_code) VALUES
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
    ('amazon_sg', 'https://www.amazon.sg', 'SG')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- CREATE INDEX FOR CONDITION QUERIES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_price_history_condition 
ON product_price_history(condition);

-- ============================================
-- UPDATE EXISTING RECORDS (set default condition)
-- ============================================
UPDATE product_price_history 
SET condition = 'new' 
WHERE condition IS NULL;

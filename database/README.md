# HeadlessX Database

## Quick Start

### 1. Start Database Services

```bash
# Start PostgreSQL and Redis
docker-compose up -d

# Start with pgAdmin (development)
docker-compose --profile dev up -d
```

### 2. Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| PostgreSQL | `localhost:5432` | `headlessx` / `headlessx_secret` |
| Redis | `localhost:6379` | Password: `headlessx_redis` |
| pgAdmin | `http://localhost:5050` | `admin@headlessx.local` / `admin` |

### 3. Install Dependencies

```bash
npm install
```

### 4. Start Application

```bash
npm run dev
```

---

## Database Schema

### Tables Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USERS                                    │
│  - id (UUID)                                                     │
│  - email, password_hash, api_key                                │
│  - role (user/admin/premium)                                    │
│  - settings, rate_limit_per_hour                                │
└─────────────────────────────────────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SCHEDULED_JOBS                              │
│  - id (UUID), user_id                                           │
│  - name, job_type, target_url, cron_expression                  │
│  - is_active, last_run_at, next_run_at                          │
└─────────────────────────────────────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      JOB_EXECUTIONS                              │
│  - id (UUID), job_id                                            │
│  - status, started_at, completed_at, duration_ms                │
│  - result (JSONB), error_message                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         STORES                                   │
│  - id (SERIAL), name, base_url, country_code                    │
│  - amazon_us, amazon_es, amazon_mx, amazon_uk, amazon_de        │
└─────────────────────────────────────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PRODUCTS                                  │
│  - id (UUID), asin, store_id                                    │
│  - name, brand, product_url, main_image_url                     │
│  - last_scraped_at, scrape_count                                │
│  - UNIQUE(asin, store_id)                                       │
└─────────────────────────────────────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PRODUCT_PRICE_HISTORY                          │
│  - id (UUID), product_id                                        │
│  - price, original_price, currency, discount_percent            │
│  - availability, seller, is_prime, rating, review_count         │
│  - scraped_by_user_id, scrape_source, raw_data (JSONB)         │
│  - created_at (for historical tracking)                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      SEARCH_QUERIES                              │
│  - id (UUID), store_id, query_url, query_url_hash               │
│  - search_term, page_number, product_count                      │
│  - expires_at (24h cache)                                       │
└─────────────────────────────────────────────────────────────────┘
         │
         │ N:M
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SEARCH_QUERY_PRODUCTS                          │
│  - search_query_id, product_id, position                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       PRICE_ALERTS                               │
│  - id (UUID), user_id, product_id                               │
│  - alert_type (price_drop/price_below/price_above/back_in_stock)│
│  - target_price, threshold_percent                              │
│  - is_active, last_triggered_at                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Authentication

All endpoints require authentication via API key:

```bash
# Header authentication
curl -H "X-API-Key: your_api_key" https://api.example.com/api/amazon/products

# Bearer token
curl -H "Authorization: Bearer your_api_key" https://api.example.com/api/amazon/products
```

### Product Scraping (with Cache)

#### Scrape Product List
```bash
POST /api/amazon/products
{
  "url": "https://www.amazon.com/s?k=laptops",
  "page": 1,
  "maxProducts": 50,
  "forceRefresh": false  # Set true to bypass 24h cache
}
```

**Response:**
```json
{
  "success": true,
  "cached": true,
  "cachedAt": "2025-12-06T20:00:00Z",
  "expiresAt": "2025-12-07T20:00:00Z",
  "products": [...],
  "productCount": 48,
  "pagination": {
    "currentPage": 1,
    "totalPages": 20,
    "hasNextPage": true,
    "nextPageUrl": "..."
  }
}
```

#### Scrape Single Product
```bash
POST /api/amazon/product
{
  "url": "https://www.amazon.com/dp/B0C5S8626M",
  "forceRefresh": false
}
```

**Response:**
```json
{
  "success": true,
  "cached": false,
  "product": {
    "asin": "B0C5S8626M",
    "name": "HP Latest Stream 14\" HD Laptop...",
    "price": 169.50,
    "originalPrice": 180.90,
    "discount": 6,
    "currency": "USD",
    "availability": "Only 8 left in stock",
    "seller": "WL Distributors",
    "rating": 4.2,
    "reviewCount": 523
  },
  "priceHistory": [...]
}
```

#### Get Price History
```bash
GET /api/amazon/product/:asin/history?days=30
```

---

### Scheduled Jobs

#### Create Job
```bash
POST /api/jobs
{
  "name": "Daily Laptop Price Check",
  "jobType": "price_monitor",
  "targetUrl": "https://www.amazon.com/dp/B0C5S8626M",
  "cronExpression": "0 9 * * *",  # Every day at 9 AM
  "timezone": "America/New_York",
  "config": {
    "useAI": true,
    "language": "en"
  }
}
```

#### Job Types
- `product_scrape` - Scrape a single product page
- `search_scrape` - Scrape search results
- `price_monitor` - Monitor price changes and trigger alerts

#### Cron Expression Examples
| Expression | Description |
|------------|-------------|
| `0 * * * *` | Every hour |
| `0 9 * * *` | Every day at 9 AM |
| `0 9,18 * * *` | At 9 AM and 6 PM |
| `0 0 * * 0` | Every Sunday at midnight |
| `*/30 * * * *` | Every 30 minutes |

#### List Jobs
```bash
GET /api/jobs?active=true
```

#### Update Job
```bash
PUT /api/jobs/:id
{
  "cronExpression": "0 */6 * * *",
  "isActive": true
}
```

#### Delete Job
```bash
DELETE /api/jobs/:id
```

#### Manually Run Job
```bash
POST /api/jobs/:id/run
```

#### Get Execution History
```bash
GET /api/jobs/:id/executions?limit=20
```

---

## Cache Behavior

### 24-Hour Cache Rule

1. **First Request**: Scrapes the page, saves to database, returns fresh data
2. **Subsequent Requests (within 24h)**: Returns cached data from database
3. **After 24 Hours**: Scrapes again, updates database, returns fresh data

### Cross-User Sharing

- If User A scrapes a URL, User B gets the cached result (within 24h)
- Each scrape creates a new price history entry
- Users can compare prices over time using the history endpoint

### Force Refresh

```json
{
  "url": "...",
  "forceRefresh": true
}
```

This bypasses the cache and scrapes fresh data.

---

## Environment Variables

```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=headlessx
POSTGRES_USER=headlessx
POSTGRES_PASSWORD=headlessx_secret
POSTGRES_POOL_SIZE=20

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=headlessx_redis

# Cache
CACHE_DURATION_HOURS=24

# Scheduled Jobs
ENABLE_SCHEDULED_JOBS=true
```

---

## Default Admin User

After database initialization:

- **Email**: `admin@headlessx.local`
- **Password**: `admin123`
- **Role**: `admin`

⚠️ **Change the password in production!**

---

## Useful SQL Queries

### Get Latest Prices for All Products
```sql
SELECT * FROM v_latest_product_prices;
```

### Get Price Trends (Last 30 Days)
```sql
SELECT * FROM v_price_trends WHERE product_id = 'uuid';
```

### Find Products by ASIN Across Stores
```sql
SELECT p.*, s.name as store
FROM products p
JOIN stores s ON p.store_id = s.id
WHERE p.asin = 'B0C5S8626M';
```

### Get User's Scheduled Jobs
```sql
SELECT * FROM scheduled_jobs WHERE user_id = 'uuid' AND is_active = true;
```

---

## Docker Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f postgres

# Stop services
docker-compose down

# Reset database (delete all data)
docker-compose down -v
docker-compose up -d

# Connect to PostgreSQL
docker exec -it headlessx-postgres psql -U headlessx -d headlessx
```

// src/services/cacheService.js
// ──────────────────────────────────────────────────────────────
// Redis persistence layer with environment-aware behavior:
//   PRODUCTION (NODE_ENV=production): Redis is REQUIRED. Crash on failure.
//   DEVELOPMENT: Graceful in-memory fallback when Redis is unavailable.
//
// SCALABILITY NOTE: All shared state flows through this service.
// In production, multiple server instances share a single Redis cluster,
// making the system horizontally scalable without sticky sessions.
// ──────────────────────────────────────────────────────────────

const Redis = require('ioredis');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test';

let redis = null;
let isRedisAvailable = false;
const startTime = Date.now();

// In-memory fallback store (development only)
const memStore = new Map();

// Initialize Redis connection
if (!IS_TEST) {
    try {
        redis = new Redis({
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: process.env.REDIS_PORT || 6379,
            maxRetriesPerRequest: 1,
            retryStrategy(times) {
                if (times > 3) {
                    if (IS_PRODUCTION) {
                        console.error('🔴 FATAL: Redis connection failed in production. Shutting down.');
                        process.exit(1);
                    }
                    return null;
                }
                return Math.min(times * 200, 2000);
            },
            lazyConnect: true,
        });

        redis.connect().then(() => {
            isRedisAvailable = true;
            console.log('✅ Redis connected');
        }).catch((err) => {
            if (IS_PRODUCTION) {
                console.error('🔴 FATAL: Redis required in production but unavailable:', err.message);
                process.exit(1);
            }
            isRedisAvailable = false;
            console.log('⚠️  Redis unavailable — using in-memory fallback (dev mode)');
        });

        redis.on('error', () => {
            if (isRedisAvailable) {
                isRedisAvailable = false;
                if (IS_PRODUCTION) {
                    console.error('🔴 Redis connection lost in production!');
                } else {
                    console.log('⚠️  Redis connection lost — falling back to in-memory');
                }
            }
        });

        redis.on('connect', () => {
            if (!isRedisAvailable) {
                isRedisAvailable = true;
                console.log('✅ Redis reconnected');
            }
        });
    } catch (e) {
        if (IS_PRODUCTION) {
            console.error('🔴 FATAL: Cannot initialize Redis in production');
            process.exit(1);
        }
        console.log('⚠️  Redis not available — using in-memory fallback (dev mode)');
    }
}

// ─── Core Operations ──────────────────────────────

const get = async (key) => {
    if (isRedisAvailable) {
        const val = await redis.get(key);
        return val ? JSON.parse(val) : null;
    }
    const val = memStore.get(key);
    return val !== undefined ? val : null;
};

const set = async (key, value) => {
    if (isRedisAvailable) {
        await redis.set(key, JSON.stringify(value));
    }
    memStore.set(key, value);
};

const setWithTTL = async (key, value, ttlSeconds) => {
    if (isRedisAvailable) {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }
    memStore.set(key, value);
    setTimeout(() => memStore.delete(key), ttlSeconds * 1000);
};

const del = async (key) => {
    if (isRedisAvailable) {
        await redis.del(key);
    }
    memStore.delete(key);
};

// ─── List Operations (for reports) ────────────────

const listPush = async (key, value) => {
    if (isRedisAvailable) {
        await redis.rpush(key, JSON.stringify(value));
    }
    if (!memStore.has(key)) memStore.set(key, []);
    memStore.get(key).push(value);
};

const listGetAll = async (key) => {
    if (isRedisAvailable) {
        const items = await redis.lrange(key, 0, -1);
        return items.map(i => JSON.parse(i));
    }
    return memStore.get(key) || [];
};

// ─── Hash Operations (for historical data) ────────

const hashSet = async (key, field, value) => {
    if (isRedisAvailable) {
        await redis.hset(key, field, JSON.stringify(value));
    }
    if (!memStore.has(key)) memStore.set(key, {});
    memStore.get(key)[field] = value;
};

const hashGet = async (key, field) => {
    if (isRedisAvailable) {
        const val = await redis.hget(key, field);
        return val ? JSON.parse(val) : null;
    }
    const obj = memStore.get(key);
    return obj ? obj[field] ?? null : null;
};

const hashGetAll = async (key) => {
    if (isRedisAvailable) {
        const obj = await redis.hgetall(key);
        if (!obj || Object.keys(obj).length === 0) return null;
        const parsed = {};
        for (const [k, v] of Object.entries(obj)) {
            parsed[k] = JSON.parse(v);
        }
        return parsed;
    }
    return memStore.get(key) || null;
};

// ─── Status ───────────────────────────────────────

const status = () => ({
    redis: isRedisAvailable,
    backend: isRedisAvailable ? 'redis' : 'in-memory',
    mode: IS_PRODUCTION ? 'production' : 'development',
    uptime: Math.round((Date.now() - startTime) / 1000),
});

module.exports = {
    get, set, setWithTTL, del,
    listPush, listGetAll,
    hashSet, hashGet, hashGetAll,
    status,
};

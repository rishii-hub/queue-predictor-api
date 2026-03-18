const express = require("express");
const cors = require("cors");
const http = require("http");
const socketService = require("./services/socketService");
const mlPredictor = require("./services/mlPredictor");
const cacheService = require("./services/cacheService");
const db = require("./config/db");

// ──────────────────────────────────────────────────────────────
// Q-Predict — Time Optimization Engine for Public Services
// ──────────────────────────────────────────────────────────────
// ARCHITECTURE:
//   - Express handles REST API (stateless — all shared state in Redis/cacheService)
//   - Socket.io handles real-time prediction broadcasts
//   - ML layer trains on startup and retrains incrementally
//   - Horizontally scalable: deploy N instances behind a load balancer
//     sharing a single Redis cluster. No sticky sessions required.
// ──────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── Request Logger Middleware ────────────────────
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path !== '/' && req.path !== '/health' && !req.path.includes('socket.io')) {
            console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});

// ─── API Routes ──────────────────────────────────
const poiRoutes = require("./routes/pois");
const reportRoutes = require("./routes/reports");
const alertRoutes = require("./routes/alerts");

app.use("/api/pois", poiRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/alerts", alertRoutes);

// ─── Health Check (Production-Grade) ─────────────
// Returns structured system status for monitoring dashboards.
app.get("/", (req, res) => {
    res.json({ 
        message: "Queue Predictor API is running!",
        system: {
            cache: cacheService.status(),
            websocket: { clients: socketService.getClientCount() },
        }
    });
});

app.get("/health", (req, res) => {
    const cache = cacheService.status();
    const mlModels = Object.keys(db.historicalData).length;
    const healthy = cache.mode === 'production' ? cache.redis : true;

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'degraded',
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: cache.uptime,
        services: {
            redis: { connected: cache.redis, mode: cache.backend },
            websocket: { active: true, clients: socketService.getClientCount() },
            ml: { modelsLoaded: mlModels, status: 'active' },
            predictionEngine: { status: 'active', method: 'EMA + ML + confidence blending' },
        },
        scalability: 'Stateless server — horizontally scalable via shared Redis layer',
    });
});

// ─── Global Error Handler ────────────────────────
app.use((err, req, res, next) => {
    console.error(`❌ Error on ${req.method} ${req.path}: ${err.message}`);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        path: req.path,
        timestamp: new Date().toISOString(),
    });
});

// ─── Initialize Socket.io ────────────────────────
socketService.init(server);

// ─── Train ML Models on Startup ──────────────────
for (const [poiId, history] of Object.entries(db.historicalData)) {
    mlPredictor.trainModel(poiId, history);
}
console.log('🧠 ML models trained for', Object.keys(db.historicalData).length, 'POIs');

// ─── Export for Testing ──────────────────────────
module.exports = app;

// ─── Start Server ────────────────────────────────
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`🚀 Server is running on port ${PORT}`);
        console.log(`📊 Health: http://localhost:${PORT}/health`);
    });
}
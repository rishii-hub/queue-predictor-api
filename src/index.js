const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");

const socketService = require("./services/socketService");
const mlPredictor = require("./services/mlPredictor");
const cacheService = require("./services/cacheService");
const db = require("./config/db");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// ✅ FIXED CORS (important for frontend)
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
}));

app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, "../frontend")));

// ─── Request Logger ─────────────────────────────
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

// ─── Routes ─────────────────────────────────────
const poiRoutes = require("./routes/pois");
const reportRoutes = require("./routes/reports");
const alertRoutes = require("./routes/alerts");

app.use("/api/pois", poiRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/alerts", alertRoutes);

// ─── ROOT ROUTE (IMPORTANT FOR RENDER TEST)
app.get("/", (req, res) => {
    res.send("🚀 Q-Predict API is running");
});

// ─── HEALTH ROUTE
app.get("/health", (req, res) => {
    const cache = cacheService.status();
    const mlModels = Object.keys(db.historicalData).length;

    res.status(200).json({
        status: "ok",
        environment: process.env.NODE_ENV || "development",
        uptime: cache.uptime,
        services: {
            redis: cache.backend,
            websocketClients: socketService.getClientCount(),
            mlModels
        }
    });
});

// ─── ERROR HANDLER
app.use((err, req, res, next) => {
    console.error(`❌ ${req.method} ${req.path}: ${err.message}`);
    res.status(500).json({
        error: err.message || "Internal server error"
    });
});

// ─── SOCKET INIT
socketService.init(server);

// ─── ML TRAINING
for (const [poiId, history] of Object.entries(db.historicalData)) {
    mlPredictor.trainModel(poiId, history);
}
console.log("🧠 ML models trained");

const db = require("./config/db");

// Catch-all → React app
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

seedReports(); // ADD THIS
// ─── START SERVER (CRITICAL FOR RENDER)
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);

        if (process.env.NODE_ENV !== "production") {
            console.log(`📊 Local: http://localhost:${PORT}/health`);
        }
    });
}

module.exports = app;
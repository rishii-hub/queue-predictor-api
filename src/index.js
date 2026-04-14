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

// ─────────────────────────────
// CORS
// ─────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "https://q-predictor-589.web.app"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"]
}));

// ─────────────────────────────
// MIDDLEWARE
// ─────────────────────────────
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (!req.path.includes("socket.io")) {
      console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// ─────────────────────────────
// ROUTES
// ─────────────────────────────
const poiRoutes = require("./routes/pois");
const reportRoutes = require("./routes/reports");
const alertRoutes = require("./routes/alerts");

app.use("/api/pois", poiRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/alerts", alertRoutes);

// ─────────────────────────────
// ROOT
// ─────────────────────────────
app.get("/", (req, res) => {
  res.send("Queue Predictor API running 🚀");
});

// ─────────────────────────────
// HEALTH
// ─────────────────────────────
app.get("/health", (req, res) => {
  const cache = cacheService.status();

  res.status(200).json({
    status: "ok",
    uptime: cache.uptime,
    services: {
      redis: cache.backend,
      websocketClients: socketService.getClientCount(),
      mlModels: Object.keys(db.historicalData).length
    }
  });
});

// ─────────────────────────────
// ERROR HANDLER
// ─────────────────────────────
app.use((err, req, res, next) => {
  console.error(`❌ ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({
    error: err.message || "Internal server error"
  });
});

// ─────────────────────────────
// SOCKET INIT
// ─────────────────────────────
socketService.init(server, allowedOrigins);

// ─────────────────────────────
// ML INIT
// ─────────────────────────────
for (const [poiId, history] of Object.entries(db.historicalData)) {
  mlPredictor.trainModel(poiId, history);
}
console.log("🧠 ML models trained");

// ─────────────────────────────
// START SERVER (ONLY ONE LISTEN)
// ─────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

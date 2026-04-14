const { Server } = require("socket.io");

let io;

function init(server, allowedOrigins = "*") {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    console.log("⚡ Client connected:", socket.id);

    socket.on("disconnect", () => {
      console.log("❌ Client disconnected:", socket.id);
    });
  });
}

// ✅ 1. Prediction update
function broadcastPredictionUpdate(poiId, data) {
  if (!io) return;
  io.emit("predictionUpdate", { poiId, ...data });
}

// ✅ 2. New report
function broadcastNewReport(report) {
  if (!io) return;
  io.emit("newReport", report);
}

// ✅ 3. Surge alert
function broadcastSurgeAlert(poiId, poiName) {
  if (!io) return;
  io.emit("surgeAlert", { poiId, poiName });
}

// ✅ Clients count
function getClientCount() {
  return io ? io.engine.clientsCount : 0;
}

module.exports = {
  init,
  broadcastPredictionUpdate,
  broadcastNewReport,
  broadcastSurgeAlert,
  getClientCount
};

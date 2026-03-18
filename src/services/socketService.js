// src/services/socketService.js
// Real-time WebSocket layer using Socket.io.
// Broadcasts prediction updates to all connected clients when reports are submitted.

const { Server } = require('socket.io');

let io = null;

/**
 * Initialize Socket.io and attach to HTTP server.
 */
const init = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
    });

    io.on('connection', (socket) => {
        console.log(`🔌 Client connected: ${socket.id}`);

        socket.on('disconnect', () => {
            console.log(`🔌 Client disconnected: ${socket.id}`);
        });
    });

    console.log('⚡ Socket.io initialized');
    return io;
};

/**
 * Broadcast a prediction update for a specific POI to all clients.
 */
const broadcastPredictionUpdate = (poiId, prediction) => {
    if (!io) return;
    io.emit('prediction:updated', { poiId, prediction, timestamp: Date.now() });
};

/**
 * Broadcast when a new report is submitted.
 */
const broadcastNewReport = (report) => {
    if (!io) return;
    io.emit('report:new', { report, timestamp: Date.now() });
};

/**
 * Broadcast surge alert.
 */
const broadcastSurgeAlert = (poiId, poiName) => {
    if (!io) return;
    io.emit('surge:alert', { poiId, poiName, timestamp: Date.now() });
};

/**
 * Get connected client count.
 */
const getClientCount = () => {
    if (!io) return 0;
    return io.engine.clientsCount || 0;
};

module.exports = {
    init,
    broadcastPredictionUpdate,
    broadcastNewReport,
    broadcastSurgeAlert,
    getClientCount,
};

const { Server } = require("socket.io");

let io;

function init(server, allowedOrigins) {
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

function getClientCount() {
    return io ? io.engine.clientsCount : 0;
}

module.exports = {
    init,
    getClientCount
};
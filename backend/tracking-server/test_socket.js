const { io } = require("socket.io-client");
const socket = io("http://localhost:3000");

socket.on("connect", () => {
    console.log("Connected. Emitting status_update for 9FCD5A11");
    socket.emit("status_update", { orderId: "9FCD5A11", status: "Entregado" });
    setTimeout(() => process.exit(0), 1000);
});

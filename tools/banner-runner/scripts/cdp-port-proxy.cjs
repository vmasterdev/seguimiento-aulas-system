#!/usr/bin/env node

const net = require("node:net");

const listenHost = process.argv[2] || "0.0.0.0";
const listenPort = Number.parseInt(process.argv[3] || "9223", 10);
const targetHost = process.argv[4] || "127.0.0.1";
const targetPort = Number.parseInt(process.argv[5] || "9222", 10);

if (!Number.isFinite(listenPort) || !Number.isFinite(targetPort)) {
  console.error("Puertos invalidos para el proxy CDP.");
  process.exit(1);
}

const server = net.createServer((clientSocket) => {
  const targetSocket = net.connect({
    host: targetHost,
    port: targetPort
  });

  const closeBoth = () => {
    clientSocket.destroy();
    targetSocket.destroy();
  };

  clientSocket.on("error", closeBoth);
  targetSocket.on("error", closeBoth);

  clientSocket.pipe(targetSocket);
  targetSocket.pipe(clientSocket);
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    process.exit(0);
  }

  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

server.listen(listenPort, listenHost);

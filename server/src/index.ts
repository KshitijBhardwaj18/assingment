// server/index.ts
import http from "http";
import express from "express";
import path from "path";
import cors from "cors";
import { WSSignalingServer } from "./signalingServer";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;


const IS_LOW_RESOURCE = process.env.LOW_RESOURCE === "true";


app.use(cors());


app.use("/hls", express.static(path.join(process.cwd(), "public", "hls")));


app.get("/health", (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB",
    },
    mode: IS_LOW_RESOURCE ? "LOW_RESOURCE" : "NORMAL",
    features: {
      webrtc: true,
      hls: true,
      ffmpeg: true,
    },
  });
});


const signalingServer = new WSSignalingServer({
  server, 
});

server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
  console.log(
    `📊 Mode: ${IS_LOW_RESOURCE ? "LOW_RESOURCE (Optimized)" : "NORMAL"}`
  );
  console.log(`🎥 HLS files served at http://localhost:${PORT}/hls/`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 WebRTC + HLS streaming ready!`);
});


process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  cleanupHlsFiles();
  signalingServer.close();
  server.close();
});

process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  cleanupHlsFiles();
  signalingServer.close();
  server.close();
  process.exit(0);
});

function cleanupHlsFiles() {
  const fs = require("fs");
  const hlsDir = path.join(process.cwd(), "public", "hls");

  try {
    if (fs.existsSync(hlsDir)) {
      const files = fs.readdirSync(hlsDir);
      let deletedCount = 0;

      files.forEach((file: string) => {
        const filePath = path.join(hlsDir, file);
        try {
          fs.unlinkSync(filePath);
          deletedCount++;
        } catch (err) {
          console.warn(`⚠️  Could not delete ${file}:`, err);
        }
      });

      if (deletedCount > 0) {
        console.log(`🗑️  Cleaned up ${deletedCount} HLS file(s)`);
      }
    }
  } catch (error) {
    console.warn("⚠️  HLS cleanup failed:", error);
  }
}

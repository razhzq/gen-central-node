const express = require('express');
const cors = require('cors');
const path = require('path');
const coreRouter = require('./router/core.router');



const app = express();
const port = process.env.PORT ||  3000;

// Allow large JSON payloads for asset create/update with base64 images
app.use(express.json({ limit: '50mb' }));
app.use(
    cors({
      origin: "*",
    })
  );

// Serve uploaded files (receipts)
const UPLOADS_DIR = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)));

app.use("/", coreRouter);

async function startServer() {
    try {
      // Start server
      app.listen(port, () => {
        console.log(
          `🚀 GEN Central Node listening at http://localhost:${port}`
        );
        console.log(
          `📊 Database health check: http://localhost:${port}/api/health/database`
        );
      });
    } catch (error) {
      console.error("❌ Failed to start server:", error.message);
  
      // If it's a database connection error, exit
      if (
        error.message.includes("connect") ||
        error.message.includes("ECONNREFUSED")
      ) {
        process.exit(1);
      } else {
        // For other errors (like migration issues), try to start the server anyway
        console.log("⚠️ Starting server despite errors...");
        app.listen(port, () => {
          console.log(
            `🚀 GEN Central Node listening at http://localhost:${port} (with warnings)`
          );
          console.log(
            `📊 Database health check: http://localhost:${port}/api/health/database`
          );
        });
      }
    }
  }

startServer();
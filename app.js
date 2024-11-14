const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const WebSocket = require("ws");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

// Initialize the app
const app = express();

// Use JSON middleware
app.use(express.json());

// Configure CORS to allow all origins (you can refine it later)
app.use(cors({ origin: "*" }));

// Set up static file serving for uploaded PDFs
app.use("/files", express.static("/mnt/data/files")); // Render's persistent storage

// WebSocket and HTTP server setup
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// MongoDB connection string (use environment variable in production)
const mongoUrl = process.env.MONGODB_URI || "mongodb+srv://saiharshatech:OdvTv6ex3wWH17wX@cluster0.md683vl.mongodb.net/pdf-viewer";

// Connect to MongoDB
mongoose
  .connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Mongoose schema for PDFs
const PdfSchema = mongoose.model(
  "PdfDetails",
  new mongoose.Schema({
    title: String,
    pdf: String,
  })
);

// Multer storage configuration (use Render's persistent disk)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "/mnt/data/files"), // Store files in Render's persistent storage
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)), // Add timestamp to avoid naming conflicts
});

const upload = multer({ storage });

let currentPdf = null;
let currentPageNumber = 1;

// Upload file route
app.post("/upload-files", upload.single("file"), async (req, res) => {
  const { title } = req.body;
  const fileName = req.file.filename;

  try {
    const existingPdf = await PdfSchema.findOne({});
    if (existingPdf) {
      const previousFilePath = `/mnt/data/files/${existingPdf.pdf}`;
      if (fs.existsSync(previousFilePath)) {
        fs.unlinkSync(previousFilePath); // Delete the previous PDF
      }
      await PdfSchema.findOneAndUpdate({}, { title, pdf: fileName }, { upsert: true });
    } else {
      await PdfSchema.create({ title, pdf: fileName });
    }

    currentPdf = `https://your-app-name.onrender.com/files/${fileName}`; // Adjust this URL if necessary
    currentPageNumber = 1;

    // Broadcast to WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "updatePdf", pdf: currentPdf, pageNumber: currentPageNumber }));
      }
    });

    res.send({ status: "ok" });
  } catch (error) {
    res.json({ status: "error", message: error.message });
  }
});

// Fetch uploaded PDFs
app.get("/get-files", async (req, res) => {
  try {
    const pdfs = await PdfSchema.find({});
    res.json({ status: "ok", data: pdfs });
  } catch (error) {
    res.json({ status: "error", message: error.message });
  }
});

// WebSocket connection for real-time PDF syncing
wss.on("connection", (ws) => {
  console.log("A user connected");

  // Send current PDF and page number to the new client
  if (currentPdf) {
    ws.send(JSON.stringify({ type: "updatePdf", pdf: currentPdf, pageNumber: currentPageNumber }));
  }

  // Handle incoming WebSocket messages
  ws.on("message", (message) => {
    const parsedMessage = JSON.parse(message);

    if (parsedMessage.type === "syncPage") {
      currentPageNumber = parsedMessage.pageNumber;
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "updatePage", pageNumber: currentPageNumber }));
        }
      });
    }
  });

  // Handle WebSocket disconnection
  ws.on("close", () => console.log("User disconnected"));
});

// Dynamically set port from environment or default to 5000 (Render sets this for you)
const port = process.env.PORT || 5000;
server.listen(port, () => console.log(`Server running on port ${port}`));

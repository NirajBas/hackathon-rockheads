const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const logger = require("./utils/logger");

dotenv.config();

const authRoutes = require("./routes/auth");
const emergencyRoutes = require("./routes/emergency");
const dispatchRoutes = require("./routes/dispatch");
const hospitalRoutes = require("./routes/hospital");
const ambulanceRoutes = require("./routes/ambulance");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*"
  })
);
app.use(express.json());
app.use(express.static("dashboard"));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "dashboard/user-dashboard.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "dashboard/login.html")));
app.get("/family", (req, res) => res.sendFile(path.join(__dirname, "dashboard/family-dashboard.html")));
app.get("/hospital", (req, res) => res.sendFile(path.join(__dirname, "dashboard/hospital-dashboard.html")));
app.get("/ambulance", (req, res) => res.sendFile(path.join(__dirname, "dashboard/ambulance-dashboard.html")));
app.get("/workflow", (req, res) => res.sendFile(path.join(__dirname, "dashboard/workflow-dashboard.html")));

app.use("/auth", authRoutes);
app.use("/emergency", emergencyRoutes);
app.use("/dispatch", dispatchRoutes);
app.use("/hospitals", hospitalRoutes);
app.use("/ambulances", ambulanceRoutes);

app.use(async (req, res) => {
  try {
    return res.status(404).json({ error: "Route not found" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown routing error" });
  }
});

app.listen(PORT, () => {
  logger.log(`Server started on port ${PORT}`);
});

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const logger = require("./utils/logger");

dotenv.config();

const authRoutes = require("./routes/auth");
const emergencyRoutes = require("./routes/emergency");
const dispatchRoutes = require("./routes/dispatch");
const hospitalRoutes = require("./routes/hospital");
const ambulanceRoutes = require("./routes/ambulance");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", async (req, res) => {
  try {
    return res.status(200).json({ message: "Emergency Response API is running" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Healthcheck failed" });
  }
});

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

const express = require("express");
const ambulanceController = require("../controllers/ambulanceController");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await ambulanceController.getAmbulances(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Ambulances route error" });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    await ambulanceController.updateAmbulanceStatus(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Update ambulance route error" });
  }
});

module.exports = router;

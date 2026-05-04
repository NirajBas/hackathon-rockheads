const express = require("express");
const emergencyController = require("../controllers/emergencyController");

const router = express.Router();

router.post("/create", async (req, res) => {
  try {
    await emergencyController.createEmergency(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Create emergency route error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    await emergencyController.getEmergencyById(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Get emergency route error" });
  }
});

module.exports = router;

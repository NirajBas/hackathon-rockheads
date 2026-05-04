const express = require("express");
const dispatchController = require("../controllers/dispatchController");

const router = express.Router();

router.post("/assign", async (req, res) => {
  try {
    await dispatchController.assignAmbulance(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Dispatch route error" });
  }
});

module.exports = router;

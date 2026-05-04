const express = require("express");
const hospitalController = require("../controllers/hospitalController");
const db = require("../config/firebase");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await hospitalController.getHospitals(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Hospitals route error" });
  }
});

// POST /hospitals/:id/update-availability — must be registered before GET /:id
router.post("/:id/update-availability", async (req, res) => {
  try {
    await hospitalController.updateAvailability(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Update availability route error" });
  }
});

router.post("/respond-specialist", async (req, res) => {
  try {
    await hospitalController.respondSpecialist(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Respond specialist route error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const snapshot = await db.collection("hospitals").doc(req.params.id).get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: "Hospital not found" });
    }

    return res.status(200).json({ hospital: { id: snapshot.id, ...snapshot.data() } });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Hospital route error" });
  }
});

module.exports = router;

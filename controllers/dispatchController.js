const dispatchService = require("../services/dispatchService");

// Manual endpoint to assign an ambulance for an emergency.
const assignAmbulance = async (req, res) => {
  try {
    const { emergencyId } = req.body;
    if (!emergencyId) {
      return res.status(400).json({ error: "emergencyId is required" });
    }

    const ambulance = await dispatchService.findAvailableAmbulance();
    if (!ambulance) {
      return res.status(404).json({ error: "No available ambulance found" });
    }

    await dispatchService.assignAmbulance(ambulance.id, emergencyId);

    return res.status(200).json({
      message: "Ambulance assigned",
      ambulance: {
        id: ambulance.id,
        type: ambulance.type
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Dispatch failed" });
  }
};

module.exports = {
  assignAmbulance
};

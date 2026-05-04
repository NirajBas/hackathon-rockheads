const db = require("../config/firebase");

// Fetches all ambulances for status monitoring.
const getAmbulances = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const snapshot = await db.collection("ambulances").get();
    const ambulances = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ ambulances });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to fetch ambulances" });
  }
};

// Updates ambulance availability state.
const updateAmbulanceStatus = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const { id } = req.params;
    const { available } = req.body;
    if (typeof available !== "boolean") {
      return res.status(400).json({ error: "available boolean is required" });
    }

    await db.collection("ambulances").doc(id).update({
      available,
      status: available ? "available" : "unavailable",
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({ message: "Ambulance status updated", id, available });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to update ambulance" });
  }
};

module.exports = {
  getAmbulances,
  updateAmbulanceStatus
};

const db = require("../config/firebase");
const logger = require("../utils/logger");

const ensureDb = () => {
  if (!db) {
    throw new Error("Firestore is not initialized. Check Firebase environment variables.");
  }
};

const PRIORITY_LABELS = {
  "108": "1st - 108 Government Emergency Service",
  govt: "2nd - Government Ambulance",
  private: "3rd - Private Ambulance"
};

/**
 * Strict dispatch: 108 first (free govt emergency), then govt, then private.
 * Returns ambulance doc with `priority` label for API/UI.
 */
const findAvailableAmbulance = async () => {
  ensureDb();
  const snapshot = await db
    .collection("ambulances")
    .where("available", "==", true)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const ambulances = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const pickFirst = (type) => ambulances.find((amb) => amb.type === type) || null;

  let chosen = pickFirst("108");
  if (chosen) {
    logger.log("108 ambulance selected - highest priority");
    return {
      ...chosen,
      priority: PRIORITY_LABELS["108"]
    };
  }

  chosen = pickFirst("govt");
  if (chosen) {
    logger.log("No 108 available, falling back to govt");
    return {
      ...chosen,
      priority: PRIORITY_LABELS.govt
    };
  }

  chosen = pickFirst("private");
  if (chosen) {
    logger.log("No govt available, falling back to private");
    return {
      ...chosen,
      priority: PRIORITY_LABELS.private
    };
  }

  return null;
};

// Assigns ambulance to emergency and marks it unavailable.
const assignAmbulance = async (ambulanceId, emergencyId) => {
  ensureDb();

  const ambulanceRef = db.collection("ambulances").doc(ambulanceId);
  const emergencyRef = db.collection("emergencies").doc(emergencyId);

  await ambulanceRef.update({
    available: false,
    status: "unavailable",
    updatedAt: new Date().toISOString()
  });

  await emergencyRef.update({
    assignedAmbulance: ambulanceId,
    updatedAt: new Date().toISOString()
  });

  logger.log(`Ambulance ${ambulanceId} assigned to emergency ${emergencyId}`);
  return true;
};

module.exports = {
  findAvailableAmbulance,
  assignAmbulance
};

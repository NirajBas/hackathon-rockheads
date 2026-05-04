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

const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatEtaMins = (distanceKm) => {
  const mins = Math.max(1, Math.round((distanceKm / 40) * 60));
  return `${mins} mins`;
};

/**
 * Strict dispatch: 108 first (free govt emergency), then govt, then private.
 * Returns ambulance doc with `priority` label for API/UI.
 */
const findAvailableAmbulance = async (location) => {
  ensureDb();
  const snapshot = await db
    .collection("ambulances")
    .where("available", "==", true)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const ambulances = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const hasValidLocation =
    location &&
    Number.isFinite(Number(location.lat)) &&
    Number.isFinite(Number(location.lng));
  const lat = hasValidLocation ? Number(location.lat) : null;
  const lng = hasValidLocation ? Number(location.lng) : null;

  const pickNearestInType = (type) => {
    const typed = ambulances.filter((amb) => amb.type === type);
    if (!typed.length) return null;

    if (!hasValidLocation) {
      const fallback = typed[0];
      return {
        ...fallback,
        distanceKm: null,
        distance: "unknown",
        estimatedArrival: "unknown"
      };
    }

    const sorted = typed
      .map((amb) => {
        const ambLat = Number(amb.location?.lat);
        const ambLng = Number(amb.location?.lng);
        const distanceKm =
          Number.isFinite(ambLat) && Number.isFinite(ambLng)
            ? haversineDistance(lat, lng, ambLat, ambLng)
            : 999;
        return { ...amb, distanceKm };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const nearest = sorted[0];
    return {
      ...nearest,
      distanceKm: nearest.distanceKm,
      distance: `${nearest.distanceKm.toFixed(1)} km away`,
      estimatedArrival: formatEtaMins(nearest.distanceKm)
    };
  };

  let chosen = pickNearestInType("108");
  if (chosen) {
    logger.log("108 ambulance selected - highest priority");
    return { ...chosen, priority: PRIORITY_LABELS["108"] };
  }

  chosen = pickNearestInType("govt");
  if (chosen) {
    logger.log("No 108 available, falling back to govt");
    return { ...chosen, priority: PRIORITY_LABELS.govt };
  }

  chosen = pickNearestInType("private");
  if (chosen) {
    logger.log("No govt available, falling back to private");
    return { ...chosen, priority: PRIORITY_LABELS.private };
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

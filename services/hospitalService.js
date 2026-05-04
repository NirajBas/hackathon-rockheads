const { v4: uuidv4 } = require("uuid");
const db = require("../config/firebase");
const logger = require("../utils/logger");

const ensureDb = () => {
  if (!db) {
    throw new Error("Firestore is not initialized. Check Firebase environment variables.");
  }
};

/** Mock distance → points: 1km tier = 20, 2km = 15, 3km+ = 5 */
const distancePoints = (km) => {
  const d = Number(km) || 999;
  if (d <= 1) return 20;
  if (d <= 2) return 15;
  return 5;
};

const buildSelectionSummary = (hospital, emergencyType) => {
  const dist = hospital.distance != null ? `${hospital.distance}km` : "unknown distance";
  return `${hospital.name} selected: ${emergencyType} specialist + ${hospital.icuBeds || 0} ICU beds + ${dist} away`;
};

const buildSelectionReason = (hospital, emergencyType) => {
  const dist = hospital.distance != null ? `${hospital.distance}km` : "unknown distance";
  return `Nearest ${emergencyType} center with ICU availability (${dist})`;
};

/**
 * Ranks hospitals: specialty match (+50), ICU (+10 each), ER (+5 each), distance tier.
 */
const selectBestHospital = async (severity, emergencyType) => {
  ensureDb();
  const snapshot = await db.collection("hospitals").get();
  const hospitals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const specialtyKey = emergencyType || "accident";

  const candidates = hospitals.filter((hospital) => {
    const specs = hospital.specialties || [];
    const hasSpecialty = specs.includes(specialtyKey);
    const hasIcu = (hospital.icuBeds || 0) > 0;
    return hasSpecialty && hasIcu;
  });

  if (!candidates.length) {
    return null;
  }

  const scored = candidates.map((hospital) => {
    const specialtyMatch = (hospital.specialties || []).includes(specialtyKey) ? 50 : 0;
    const icuPts = (hospital.icuBeds || 0) * 10;
    const erPts = (hospital.erBeds || 0) * 5;
    const distPts = distancePoints(hospital.distance);
    const score = specialtyMatch + icuPts + erPts + distPts;
    return { hospital, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const hospital = best.hospital;
  const score = best.score;

  const selectionReason = buildSelectionReason(hospital, specialtyKey);
  logger.log(buildSelectionSummary(hospital, specialtyKey));

  return {
    id: hospital.id,
    name: hospital.name,
    icuBeds: hospital.icuBeds,
    erBeds: hospital.erBeds,
    specialties: hospital.specialties,
    location: hospital.location,
    distance: hospital.distance,
    selectionReason,
    score
  };
};

// Logs and persists an outbound hospital notification event (includes score + reason for dashboards).
const notifyHospital = async (hospitalId, payload) => {
  ensureDb();
  const notificationId = `notif_${uuidv4()}`;
  const notification = {
    id: notificationId,
    hospitalId,
    ...payload,
    createdAt: new Date().toISOString()
  };

  logger.log("Hospital notification payload:", notification);

  await db.collection("notifications").doc(notificationId).set(notification);
  return notification;
};

module.exports = {
  selectBestHospital,
  notifyHospital
};

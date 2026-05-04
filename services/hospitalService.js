const { v4: uuidv4 } = require("uuid");
const db = require("../config/firebase");
const logger = require("../utils/logger");

const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const ensureDb = () => {
  if (!db) {
    throw new Error("Firestore is not initialized. Check Firebase environment variables.");
  }
};

const distancePoints = (km) => {
  const d = Number(km);
  if (!Number.isFinite(d)) return 5;
  if (d < 1) return 50;
  if (d < 2) return 40;
  if (d < 3) return 30;
  if (d < 5) return 20;
  if (d < 10) return 10;
  return 5;
};

const buildSelectionSummary = (hospital, emergencyType, distanceKm) => {
  const dist = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)}km` : "unknown distance";
  return `${hospital.name} selected: ${emergencyType} specialist + ${hospital.icuBeds || 0} ICU beds + ${dist} away`;
};

const buildSelectionReason = (hospital, emergencyType, distanceKm) => {
  const dist = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)}km` : "unknown distance";
  return `Nearest ${emergencyType} center with ICU availability (${dist})`;
};

const selectBestHospital = async (severity, emergencyType, location) => {
  ensureDb();
  const snapshot = await db.collection("hospitals").get();
  const hospitals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const specialtyKey = emergencyType || "accident";

  if (!hospitals.length) {
    return null;
  }

  const hasValidLocation =
    location &&
    Number.isFinite(Number(location.lat)) &&
    Number.isFinite(Number(location.lng));

  const scored = hospitals.map((hospital) => {
    const specialtyMatch = (hospital.specialties || []).includes(specialtyKey) ? 100 : 0;
    const icuPts = Math.max(0, Number(hospital.icuBeds) || 0) * 30;
    const erPts = Math.max(0, Number(hospital.erBeds) || 0) * 10;
    const realDistance =
      hasValidLocation && hospital.location
        ? haversineDistance(
            Number(location.lat),
            Number(location.lng),
            Number(hospital.location.lat),
            Number(hospital.location.lng)
          )
        : Number(hospital.distance) || 999;
    const distPts = distancePoints(realDistance);
    const score = specialtyMatch + icuPts + erPts + distPts;
    return { hospital, score, distanceKm: realDistance };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const hospital = best.hospital;
  const score = best.score;
  const distanceKm = best.distanceKm;

  const selectionReason = buildSelectionReason(hospital, specialtyKey, distanceKm);
  logger.log(buildSelectionSummary(hospital, specialtyKey, distanceKm));

  return {
    id: hospital.id,
    name: hospital.name,
    icuBeds: hospital.icuBeds,
    erBeds: hospital.erBeds,
    specialties: hospital.specialties,
    location: hospital.location,
    distance: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
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

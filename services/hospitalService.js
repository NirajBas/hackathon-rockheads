const { v4: uuidv4 } = require("uuid");
const admin = require("firebase-admin");
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getNearbyHospitals = async (patientLocation, radiusKm = 20) => {
  ensureDb();
  const snapshot = await db.collection("hospitals").get();
  const hospitals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const hasValidLocation =
    patientLocation &&
    Number.isFinite(Number(patientLocation.lat)) &&
    Number.isFinite(Number(patientLocation.lng));
  if (!hasValidLocation) return hospitals.map((hospital) => ({ ...hospital, distanceKm: null }));
  return hospitals
    .map((hospital) => {
      const hasHospitalLocation =
        Number.isFinite(Number(hospital.location?.lat)) &&
        Number.isFinite(Number(hospital.location?.lng));
      const distanceKm = hasHospitalLocation
        ? haversineDistance(
            Number(patientLocation.lat),
            Number(patientLocation.lng),
            Number(hospital.location.lat),
            Number(hospital.location.lng)
          )
        : 999;
      return { ...hospital, distanceKm };
    })
    .filter((hospital) => hospital.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
};

const broadcastToNearbyHospitals = async (
  emergencyId,
  patientLocation,
  emergencyType,
  patientInfo,
  requiredSpecialty
) => {
  ensureDb();
  const nearbyHospitals = await getNearbyHospitals(patientLocation, 20);
  const batch = db.batch();
  const requests = nearbyHospitals.map((hospital) => {
    const requestId = `req_${uuidv4()}`;
    const requestDoc = {
      id: requestId,
      emergencyId,
      hospitalId: hospital.id,
      hospitalName: hospital.name || "Unknown Hospital",
      patientInfo: {
        name: patientInfo.name || "Unknown",
        age: Number.isFinite(Number(patientInfo.age)) ? Number(patientInfo.age) : "Unknown",
        bloodGroup: patientInfo.bloodGroup || "Unknown",
        emergencyType: emergencyType || "accident",
        severity: patientInfo.severity || "medium",
        urgencyScore: Number.isFinite(Number(patientInfo.urgencyScore))
          ? Number(patientInfo.urgencyScore)
          : null,
        location: patientLocation || null
      },
      requiredSpecialty: requiredSpecialty || "general",
      hasSpecialist: false,
      specialistName: null,
      specialty: null,
      availableICUBeds: null,
      availableERBeds: null,
      status: "pending",
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      distanceKm: Number.isFinite(hospital.distanceKm) ? Number(hospital.distanceKm.toFixed(2)) : null
    };
    console.log("[Firestore Write] hospitalRequests:", requestDoc);
    batch.set(db.collection("hospitalRequests").doc(requestId), requestDoc);
    return {
      id: hospital.id,
      name: hospital.name || "Unknown Hospital",
      location: hospital.location || null,
      icuBeds: Number(hospital.icuBeds) || 0,
      erBeds: Number(hospital.erBeds) || 0,
      specialties: hospital.specialties || [],
      distanceKm: Number.isFinite(hospital.distanceKm) ? Number(hospital.distanceKm.toFixed(2)) : null,
      requestId
    };
  });
  await batch.commit();
  return requests;
};

const waitForSpecialistResponse = async (emergencyId, timeoutMs = 30000, intervalMs = 2000) => {
  ensureDb();
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const responseSnap = await db
      .collection("hospitalRequests")
      .where("emergencyId", "==", emergencyId)
      .where("status", "==", "responded")
      .where("hasSpecialist", "==", true)
      .orderBy("respondedAt", "asc")
      .limit(1)
      .get();
    if (!responseSnap.empty) {
      const response = responseSnap.docs[0].data();
      logger.log(`Specialist response selected for ${emergencyId}: ${response.hospitalId}`);
      return response;
    }
    await sleep(intervalMs);
  }
  return null;
};

const selectBestHospital = async (_severity, emergencyType, patientLocation) => {
  const nearby = await getNearbyHospitals(patientLocation, 20);
  const best = nearby[0];
  if (!best) return null;
  return {
    id: best.id,
    name: best.name,
    icuBeds: Number(best.icuBeds) || 0,
    erBeds: Number(best.erBeds) || 0,
    specialties: best.specialties || [],
    location: best.location || null,
    distance: Number.isFinite(best.distanceKm) ? Number(best.distanceKm.toFixed(2)) : null,
    selectionReason: `Nearest ${emergencyType || "general"} center`,
    score: 0
  };
};

// Writes the exact notification structure consumed by hospital dashboard listeners.
const notifyHospital = async (hospitalId, payload) => {
  ensureDb();
  const notificationId = `notif_${uuidv4()}`;
  const notification = {
    id: notificationId,
    hospitalId: hospitalId || "hosp_001",
    emergencyId: payload.emergencyId,
    severity: payload.severity || "high",
    emergencyType: payload.emergencyType || "trauma",
    bloodGroup: payload.bloodGroup || "Unknown",
    patientName: payload.patientName || "Unknown",
    patientAge: Number.isFinite(Number(payload.patientAge)) ? Number(payload.patientAge) : "Unknown",
    eta: payload.eta || "unknown",
    ambulanceId: payload.ambulanceId || null,
    ambulanceType: payload.ambulanceType || "unknown",
    ambulancePriority: payload.ambulancePriority || "unknown",
    ambulanceDistance: payload.ambulanceDistance || "unknown",
    patientLocation: payload.patientLocation || null,
    urgencyScore: Number.isFinite(Number(payload.urgencyScore)) ? Number(payload.urgencyScore) : null,
    selectionReason: payload.selectionReason || "Hospital selected by distance and bed availability",
    hospitalScore: Number.isFinite(Number(payload.hospitalScore)) ? Number(payload.hospitalScore) : null,
    hospitalName: payload.hospitalName || "Unknown",
    hospitalLocation: payload.hospitalLocation || null,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };

  console.log("[Firestore Write] notifications:", notification);
  logger.log("Hospital notification payload:", notification);

  await db.collection("notifications").doc(notificationId).set(notification);
  return notification;
};

module.exports = {
  haversineDistance,
  getNearbyHospitals,
  selectBestHospital,
  broadcastToNearbyHospitals,
  waitForSpecialistResponse,
  notifyHospital
};

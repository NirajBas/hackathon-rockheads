const { v4: uuidv4 } = require("uuid");
const admin = require("firebase-admin");
const db = require("../config/firebase");
const aiService = require("../services/aiService");
const dispatchService = require("../services/dispatchService");
const hospitalService = require("../services/hospitalService");
const logger = require("../utils/logger");

const estimateEta = (distanceKm) => {
  const mins = Math.max(1, Math.round((Number(distanceKm) / 40) * 60));
  return Number.isFinite(mins) ? `${mins} mins` : "unknown";
};

const KNOWN_CONDITIONS = new Set(["trauma", "cardiac"]);

const resolvePatientLocation = (location) => {
  if (
    location &&
    Number.isFinite(Number(location.lat)) &&
    Number.isFinite(Number(location.lng))
  ) {
    return {
      lat: Number(location.lat),
      lng: Number(location.lng),
      accuracy: Number(location.accuracy) || null,
      updatedAt: location.updatedAt || new Date().toISOString()
    };
  }
  return null;
};

const buildHospitalFromResponse = async (responseDoc, fallbackNearbyHospitals) => {
  const hospitalSnap = await db.collection("hospitals").doc(responseDoc.hospitalId).get();
  if (!hospitalSnap.exists) {
    const fallback = fallbackNearbyHospitals.find((h) => h.id === responseDoc.hospitalId);
    return {
      id: responseDoc.hospitalId,
      name: responseDoc.hospitalName || fallback?.name || "Unknown Hospital",
      location: fallback?.location || null,
      icuBeds: Number(responseDoc.availableICUBeds) || 0,
      erBeds: Number(responseDoc.availableERBeds) || 0,
      distance: Number(responseDoc.distanceKm) || fallback?.distanceKm || null,
      selectionReason: "First specialist response received"
    };
  }
  const hospital = hospitalSnap.data() || {};
  const fallback = fallbackNearbyHospitals.find((h) => h.id === responseDoc.hospitalId);
  return {
    id: responseDoc.hospitalId,
    name: hospital.name || responseDoc.hospitalName || "Unknown Hospital",
    location: hospital.location || fallback?.location || null,
    icuBeds: Number(responseDoc.availableICUBeds) || Number(hospital.icuBeds) || 0,
    erBeds: Number(responseDoc.availableERBeds) || Number(hospital.erBeds) || 0,
    distance: Number(responseDoc.distanceKm) || fallback?.distanceKm || null,
    selectionReason: "First specialist response received"
  };
};

const createEmergency = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const { userId, trigger, bloodGroup, location, patientName, patientAge } = req.body;
    if (!userId || !trigger) {
      return res.status(400).json({ error: "userId and trigger are required" });
    }

    const classification = await aiService.classifyEmergency(trigger);
    const {
      severity,
      emergencyType,
      recommendedSpecialty,
      requiredBeds,
      urgencyScore
    } = classification;

    const emergencyId = `em_${uuidv4()}`;
    const patientLocation = resolvePatientLocation(location);
    const knownCondition = KNOWN_CONDITIONS.has(emergencyType);

    const emergencyDoc = {
      id: emergencyId,
      userId,
      trigger,
      severity,
      emergencyType,
      recommendedSpecialty,
      requiredBeds,
      urgencyScore,
      bloodGroup: bloodGroup || "Unknown",
      patientName: patientName || "Unknown",
      patientAge: Number.isFinite(Number(patientAge)) ? Number(patientAge) : "Unknown",
      location: patientLocation,
      status: knownCondition ? "awaiting_specialist_response" : "broadcasting_hospitals",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log("[Firestore Write] emergencies:", emergencyDoc);
    await db.collection("emergencies").doc(emergencyId).set(emergencyDoc);

    const nearbyHospitals = await hospitalService.broadcastToNearbyHospitals(
      emergencyId,
      patientLocation,
      emergencyType,
      {
        name: patientName,
        age: patientAge,
        bloodGroup,
        severity,
        urgencyScore
      },
      recommendedSpecialty
    );

    const ambulance = await dispatchService.findAvailableAmbulance(patientLocation);
    if (!ambulance) {
      await db.collection("emergencies").doc(emergencyId).update({
        status: "awaiting_ambulance",
        nearbyHospitalsNotified: nearbyHospitals.length,
        updatedAt: new Date().toISOString()
      });
      return res.status(404).json({ error: "No available ambulance found" });
    }
    console.log("[Emergency Flow] Ambulance candidate selected:", {
      emergencyId,
      ambulanceId: ambulance.id,
      type: ambulance.type
    });

    let selectedHospital = null;
    let assignmentReason = "Auto-assigned: nearest hospital";
    let specialistResponse = null;

    if (knownCondition) {
      specialistResponse = await hospitalService.waitForSpecialistResponse(emergencyId, 30000, 2000);
      if (specialistResponse) {
        selectedHospital = await buildHospitalFromResponse(specialistResponse, nearbyHospitals);
        assignmentReason = "Auto-assigned: specialist available";
      }
    }

    if (!selectedHospital) {
      const nearest = nearbyHospitals[0] || null;
      if (!nearest) {
        await db.collection("emergencies").doc(emergencyId).update({
          status: "awaiting_hospital",
          assignedAmbulance: ambulance.id,
          nearbyHospitalsNotified: 0,
          updatedAt: new Date().toISOString()
        });
        return res.status(404).json({ error: "No nearby hospitals available within 20km" });
      }
      selectedHospital = {
        id: nearest.id,
        name: nearest.name,
        location: nearest.location || null,
        icuBeds: nearest.icuBeds || 0,
        erBeds: nearest.erBeds || 0,
        distance: nearest.distanceKm,
        selectionReason: "Nearest hospital fallback"
      };
    }

    await dispatchService.assignAmbulance(ambulance.id, emergencyId);

    const eta = estimateEta(selectedHospital.distance);
    const notification = await hospitalService.notifyHospital(selectedHospital.id, {
      emergencyId,
      severity,
      emergencyType,
      urgencyScore,
      eta,
      bloodGroup: bloodGroup || "Unknown",
      patientName: patientName || "Unknown",
      patientAge: Number.isFinite(Number(patientAge)) ? Number(patientAge) : "Unknown",
      patientLocation,
      ambulanceId: ambulance.id,
      ambulanceType: ambulance.type,
      ambulancePriority: ambulance.priority || "1st - 108 Government Emergency Service",
      ambulanceDistance: ambulance.distance || "unknown",
      selectionReason:
        assignmentReason === "Auto-assigned: specialist available"
          ? `Specialist ${specialistResponse?.specialistName || "available"} responded first`
          : selectedHospital.selectionReason || "Nearest hospital fallback",
      hospitalName: selectedHospital.name,
      hospitalLocation: selectedHospital.location
    });

    const emergencyUpdate = {
      assignedHospital: selectedHospital.id,
      assignedAmbulance: ambulance.id,
      notificationId: notification.id,
      status: "dispatched",
      assignmentReason,
      nearbyHospitalsNotified: nearbyHospitals.length,
      updatedAt: new Date().toISOString()
    };
    console.log("[Firestore Write] emergencies update:", { emergencyId, ...emergencyUpdate });
    await db.collection("emergencies").doc(emergencyId).update(emergencyUpdate);

    const assignmentId = `asg_${uuidv4()}`;
    const assignmentDoc = {
      id: assignmentId,
      emergencyId,
      ambulanceId: ambulance.id,
      patientInfo: {
        name: patientName || "Unknown",
        age: Number.isFinite(Number(patientAge)) ? Number(patientAge) : "Unknown",
        bloodGroup: bloodGroup || "Unknown",
        emergencyType,
        severity,
        urgencyScore,
        location: patientLocation
      },
      hospitalInfo: {
        id: selectedHospital.id,
        name: selectedHospital.name,
        location: selectedHospital.location || null,
        icuBeds: selectedHospital.icuBeds || 0,
        erBeds: selectedHospital.erBeds || 0,
        specialistName: specialistResponse?.specialistName || null,
        specialty: emergencyType,
        distance: selectedHospital.distance || null
      },
      ambulanceInfo: {
        id: ambulance.id,
        type: ambulance.type,
        priority: ambulance.priority,
        distance: ambulance.distance || "unknown",
        estimatedArrival: ambulance.estimatedArrival || "unknown"
      },
      status: "assigned",
      assignmentReason,
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      statusHistory: [
        {
          status: "assigned",
          at: new Date().toISOString()
        }
      ]
    };
    console.log("[Firestore Write] ambulanceAssignments:", assignmentDoc);
    await db.collection("ambulanceAssignments").doc(assignmentId).set(assignmentDoc);
    const ambulanceLocationDoc = {
      ambulanceId: ambulance.id,
      emergencyId,
      lat: Number(ambulance.location?.lat) || null,
      lng: Number(ambulance.location?.lng) || null,
      updatedAt: new Date().toISOString()
    };
    console.log("[Firestore Write] ambulanceLocations:", ambulanceLocationDoc);
    await db.collection("ambulanceLocations").doc(ambulance.id).set(ambulanceLocationDoc, { merge: true });

    logger.log(`Emergency ${emergencyId} dispatched successfully`);

    return res.status(201).json({
      emergencyId,
      severity,
      urgencyScore,
      type: emergencyType,
      requiredSpecialty: recommendedSpecialty,
      ambulance: {
        id: ambulance.id,
        type: ambulance.type,
        priority: ambulance.priority,
        distance: ambulance.distance || "unknown",
        estimatedArrival: ambulance.estimatedArrival || "unknown"
      },
      hospital: {
        id: selectedHospital.id,
        name: selectedHospital.name,
        eta,
        icuBeds: selectedHospital.icuBeds,
        erBeds: selectedHospital.erBeds,
        specialty: emergencyType,
        selectionReason: selectedHospital.selectionReason,
        assignmentReason,
        distance: Number.isFinite(Number(selectedHospital.distance))
          ? `${Number(selectedHospital.distance).toFixed(2)} km`
          : "unknown",
        location: selectedHospital.location || null
      },
      nearbyHospitalsNotified: nearbyHospitals.length,
      patientLocation,
      status: "dispatched"
    });
  } catch (error) {
    logger.error("createEmergency failed:", error.message);
    return res.status(500).json({ error: error.message || "Failed to create emergency" });
  }
};

// Fetches one emergency by id.
const getEmergencyById = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const { id } = req.params;
    const snapshot = await db.collection("emergencies").doc(id).get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    return res.status(200).json({ emergency: snapshot.data() });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to fetch emergency" });
  }
};

const getEmergencyStatus = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }
    const { id } = req.params;
    const snapshot = await db.collection("emergencies").doc(id).get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: "Emergency not found" });
    }
    const emergency = snapshot.data();
    return res.status(200).json({
      emergencyId: emergency.id,
      status: emergency.status,
      assignedHospital: emergency.assignedHospital || null,
      assignedAmbulance: emergency.assignedAmbulance || null,
      assignmentReason: emergency.assignmentReason || null,
      updatedAt: emergency.updatedAt || null
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to fetch emergency status" });
  }
};

module.exports = {
  createEmergency,
  getEmergencyById,
  getEmergencyStatus
};

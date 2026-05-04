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

// Orchestrates full emergency lifecycle from classification to notification.
const createEmergency = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const { userId, trigger, bloodGroup, location, patientName, patientAge, additionalNotes, familyMembers } =
      req.body;
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
      patientName: patientName || null,
      patientAge: Number.isFinite(Number(patientAge)) ? Number(patientAge) : null,
      location:
        location &&
        Number.isFinite(Number(location.lat)) &&
        Number.isFinite(Number(location.lng))
          ? {
              lat: Number(location.lat),
              lng: Number(location.lng),
              accuracy: Number(location.accuracy) || null,
              updatedAt: location.updatedAt || new Date().toISOString()
            }
          : null,
      additionalNotes: additionalNotes || null,
      familyMembers: Array.isArray(familyMembers) ? familyMembers : [],
      status: "pending_dispatch",
      createdAt: new Date().toISOString()
    };

    console.log("[Firestore Write] emergencies:", emergencyDoc);
    await db.collection("emergencies").doc(emergencyId).set(emergencyDoc);

    const ambulance = await dispatchService.findAvailableAmbulance(emergencyDoc.location);
    if (!ambulance) {
      await db.collection("emergencies").doc(emergencyId).update({ status: "awaiting_ambulance" });
      return res.status(404).json({ error: "No available ambulance found" });
    }

    await dispatchService.assignAmbulance(ambulance.id, emergencyId);

    const hospital = await hospitalService.selectBestHospital(severity, emergencyType, emergencyDoc.location);
    if (!hospital) {
      await db.collection("emergencies").doc(emergencyId).update({ status: "awaiting_hospital" });
      return res.status(404).json({ error: "No suitable hospital available" });
    }

    const eta = estimateEta(hospital.distance);
    const notification = await hospitalService.notifyHospital(hospital.id, {
      emergencyId,
      severity,
      emergencyType,
      urgencyScore,
      eta,
      bloodGroup: bloodGroup || "Unknown",
      patientName: patientName || "Unknown",
      patientAge: Number.isFinite(Number(patientAge)) ? Number(patientAge) : "Unknown",
      patientLocation: emergencyDoc.location,
      ambulanceId: ambulance.id,
      ambulanceType: ambulance.type,
      ambulancePriority: ambulance.priority || "1st - 108 Government Emergency Service",
      ambulanceDistance: ambulance.distance || "unknown",
      hospitalScore: hospital.score,
      selectionReason: hospital.selectionReason || "Nearest trauma center",
      hospitalName: hospital.name,
      hospitalLocation: hospital.location
    });

    await db.collection("emergencies").doc(emergencyId).update({
      assignedHospital: hospital.id,
      assignedAmbulance: ambulance.id,
      notificationId: notification.id,
      status: "dispatched",
      updatedAt: new Date().toISOString()
    });

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
        location: emergencyDoc.location
      },
      hospitalInfo: {
        id: hospital.id,
        name: hospital.name,
        location: hospital.location || null,
        icuBeds: hospital.icuBeds || 0,
        erBeds: hospital.erBeds || 0,
        specialty: emergencyType,
        distance: hospital.distance
      },
      ambulanceInfo: {
        id: ambulance.id,
        type: ambulance.type,
        priority: ambulance.priority,
        distance: ambulance.distance || "unknown",
        estimatedArrival: ambulance.estimatedArrival || "unknown"
      },
      status: "assigned",
      assignedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    console.log("[Firestore Write] ambulanceAssignments:", assignmentDoc);
    await db.collection("ambulanceAssignments").doc(assignmentId).set(assignmentDoc);

    logger.log(`Emergency ${emergencyId} dispatched successfully`);

    return res.status(201).json({
      emergencyId,
      severity,
      urgencyScore,
      type: emergencyType,
      recommendedSpecialty,
      requiredBeds,
      ambulance: {
        id: ambulance.id,
        type: ambulance.type,
        priority: ambulance.priority,
        distance: ambulance.distance || "unknown",
        estimatedArrival: ambulance.estimatedArrival || "unknown"
      },
      hospital: {
        name: hospital.name,
        eta,
        icuBeds: hospital.icuBeds,
        erBeds: hospital.erBeds,
        specialty: emergencyType,
        selectionReason: hospital.selectionReason,
        score: hospital.score,
        distance: Number.isFinite(Number(hospital.distance)) ? `${Number(hospital.distance).toFixed(1)} km` : "unknown",
        location: hospital.location || null
      },
      patientLocation: emergencyDoc.location,
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

module.exports = {
  createEmergency,
  getEmergencyById
};

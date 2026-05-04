const { v4: uuidv4 } = require("uuid");
const db = require("../config/firebase");
const aiService = require("../services/aiService");
const dispatchService = require("../services/dispatchService");
const hospitalService = require("../services/hospitalService");
const logger = require("../utils/logger");

// Generates a simple ETA string for demo response payloads.
const estimateEta = (severity) => {
  if (severity === "high") return "8 mins";
  if (severity === "medium") return "12 mins";
  return "18 mins";
};

// Orchestrates full emergency lifecycle from classification to notification.
const createEmergency = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const { userId, trigger, bloodGroup ,location} = req.body;
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
      status: "pending_dispatch",
      createdAt: new Date().toISOString()
    };

    await db.collection("emergencies").doc(emergencyId).set(emergencyDoc);

    const ambulance = await dispatchService.findAvailableAmbulance();
    if (!ambulance) {
      await db.collection("emergencies").doc(emergencyId).update({ status: "awaiting_ambulance" });
      return res.status(404).json({ error: "No available ambulance found" });
    }

    await dispatchService.assignAmbulance(ambulance.id, emergencyId);

    const hospital = await hospitalService.selectBestHospital(severity, emergencyType,location);
    if (!hospital) {
      await db.collection("emergencies").doc(emergencyId).update({ status: "awaiting_hospital" });
      return res.status(404).json({ error: "No suitable hospital available" });
    }

    const eta = estimateEta(severity);
    const notification = await hospitalService.notifyHospital(hospital.id, {
      emergencyId,
      severity,
      emergencyType,
      recommendedSpecialty,
      requiredBeds,
      urgencyScore,
      eta,
      bloodGroup: bloodGroup || "Unknown",
      ambulance: {
        id: ambulance.id,
        type: ambulance.type,
        priority: ambulance.priority
      },
      hospitalScore: hospital.score,
      hospitalSelectionReason: hospital.selectionReason,
      hospitalName: hospital.name,
      hospitalIcuBeds: hospital.icuBeds,
      hospitalSpecialty: emergencyType
    });

    await db.collection("emergencies").doc(emergencyId).update({
      assignedHospital: hospital.id,
      notificationId: notification.id,
      status: "dispatched",
      updatedAt: new Date().toISOString()
    });

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
        priority: ambulance.priority
      },
      hospital: {
        name: hospital.name,
        eta,
        icuBeds: hospital.icuBeds,
        specialty: emergencyType,
        selectionReason: hospital.selectionReason,
        score: hospital.score
      },
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

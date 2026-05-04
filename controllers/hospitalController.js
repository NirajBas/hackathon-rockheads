const { v4: uuidv4 } = require("uuid");
const admin = require("firebase-admin");
const db = require("../config/firebase");
const hospitalService = require("../services/hospitalService");

// Returns all hospitals from Firestore.
const getHospitals = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const snapshot = await db.collection("hospitals").get();
    const hospitals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return res.status(200).json({ hospitals });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to fetch hospitals" });
  }
};

// Selects one hospital using severity and emergency type filters.
const selectHospital = async (req, res) => {
  try {
    const { severity, emergencyType } = req.query;
    if (!severity || !emergencyType) {
      return res
        .status(400)
        .json({ error: "severity and emergencyType query params are required" });
    }

    const hospital = await hospitalService.selectBestHospital(severity, emergencyType);
    if (!hospital) {
      return res.status(404).json({ error: "No suitable hospital found" });
    }

    return res.status(200).json({ hospital });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Hospital selection failed" });
  }
};

/**
 * POST /hospitals/:id/update-availability
 * Updates hospital bed counts, emergency outcome, and hospitalResponses audit doc.
 */
const updateAvailability = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const hospitalId = req.params.id;
    const {
      emergencyId,
      icuBeds,
      erBeds,
      specialistName,
      specialty,
      status
    } = req.body;

    if (!emergencyId) {
      return res.status(400).json({ error: "emergencyId is required" });
    }
    if (icuBeds === undefined || erBeds === undefined) {
      return res.status(400).json({ error: "icuBeds and erBeds are required" });
    }
    if (!specialistName || !specialty) {
      return res.status(400).json({ error: "specialistName and specialty are required" });
    }
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'accepted' or 'rejected'" });
    }

    const hospitalRef = db.collection("hospitals").doc(hospitalId);
    const emergencyRef = db.collection("emergencies").doc(emergencyId);
    const hospitalSnap = await hospitalRef.get();
    const emergencySnap = await emergencyRef.get();

    if (!hospitalSnap.exists) {
      return res.status(404).json({ error: "Hospital not found" });
    }
    if (!emergencySnap.exists) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    const emergencyStatus = status === "accepted" ? "hospital_accepted" : "hospital_rejected";
    const respondedAtIso = new Date().toISOString();
    const responseId = `hr_${uuidv4()}`;

    const responseDoc = {
      emergencyId,
      hospitalId,
      specialistName,
      specialty,
      icuBeds: Number(icuBeds),
      erBeds: Number(erBeds),
      status,
      respondedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    console.log("[Firestore Write] hospitalResponses:", responseDoc);

    const batch = db.batch();
    batch.update(hospitalRef, {
      icuBeds: Number(icuBeds),
      erBeds: Number(erBeds),
      updatedAt: respondedAtIso
    });
    batch.update(emergencyRef, {
      status: emergencyStatus,
      hospitalResponseId: responseId,
      updatedAt: respondedAtIso
    });
    batch.set(db.collection("hospitalResponses").doc(responseId), responseDoc);

    await batch.commit();

    if (status === "accepted") {
      const assignmentSnap = await db
        .collection("ambulanceAssignments")
        .where("emergencyId", "==", emergencyId)
        .get();

      const updatePayload = {
        "hospitalInfo.specialistName": specialistName,
        "hospitalInfo.confirmedIcuBeds": Number(icuBeds),
        "hospitalInfo.confirmedErBeds": Number(erBeds),
        status: "hospital_confirmed",
        updatedAt: new Date().toISOString()
      };

      const assignmentBatch = db.batch();
      assignmentSnap.forEach((doc) => {
        console.log("[Firestore Write] ambulanceAssignments update:", {
          assignmentId: doc.id,
          ...updatePayload
        });
        assignmentBatch.update(doc.ref, updatePayload);
      });
      if (!assignmentSnap.empty) {
        await assignmentBatch.commit();
      }
    }

    return res.status(200).json({
      success: true,
      hospitalId,
      emergencyId,
      icuBeds: Number(icuBeds),
      erBeds: Number(erBeds),
      specialistName,
      specialty,
      status,
      emergencyStatus,
      responseId,
      respondedAt: respondedAtIso
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to update availability" });
  }
};

const respondSpecialist = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }
    const {
      requestId,
      hospitalId,
      emergencyId,
      hasSpecialist,
      specialistName,
      specialty,
      availableICUBeds,
      availableERBeds
    } = req.body;
    if (!requestId || !hospitalId || !emergencyId) {
      return res.status(400).json({ error: "requestId, hospitalId, emergencyId are required" });
    }
    if (!hasSpecialist) {
      return res.status(200).json({ assigned: false, message: "No specialist declared. Request remains pending." });
    }
    if (!specialistName || !specialty) {
      return res.status(400).json({ error: "specialistName and specialty are required" });
    }

    const requestRef = db.collection("hospitalRequests").doc(requestId);
    const emergencyRef = db.collection("emergencies").doc(emergencyId);
    const [requestSnap, emergencySnap] = await Promise.all([requestRef.get(), emergencyRef.get()]);
    if (!requestSnap.exists) {
      return res.status(404).json({ error: "Hospital request not found" });
    }
    if (!emergencySnap.exists) {
      return res.status(404).json({ error: "Emergency not found" });
    }

    const emergency = emergencySnap.data();
    const request = requestSnap.data();
    const responsePayload = {
      hasSpecialist: true,
      specialistName,
      specialty,
      availableICUBeds: Number(availableICUBeds) || 0,
      availableERBeds: Number(availableERBeds) || 0,
      status: "responded",
      respondedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    console.log("[Firestore Write] hospitalRequests update:", { requestId, ...responsePayload });
    await requestRef.set(responsePayload, { merge: true });

    if (emergency.assignedHospital) {
      return res.status(200).json({ assigned: false, message: "Emergency already assigned to another hospital." });
    }

    const emergencyUpdate = {
      assignedHospital: hospitalId,
      status: "hospital_assigned",
      assignmentReason: "Auto-assigned: specialist available",
      updatedAt: new Date().toISOString()
    };
    console.log("[Firestore Write] emergencies specialist assignment:", { emergencyId, ...emergencyUpdate });
    await emergencyRef.update(emergencyUpdate);

    const hospitalSnap = await db.collection("hospitals").doc(hospitalId).get();
    const hospital = hospitalSnap.exists ? hospitalSnap.data() : {};
    await hospitalService.notifyHospital(hospitalId, {
      emergencyId,
      severity: emergency.severity,
      emergencyType: emergency.emergencyType,
      bloodGroup: emergency.bloodGroup,
      patientName: emergency.patientName,
      patientAge: emergency.patientAge,
      eta: "pending ambulance routing",
      ambulanceId: emergency.assignedAmbulance || null,
      ambulanceType: "unknown",
      ambulancePriority: "unknown",
      ambulanceDistance: "unknown",
      patientLocation: emergency.location || null,
      urgencyScore: emergency.urgencyScore,
      selectionReason: `Specialist ${specialistName} responded`,
      hospitalName: hospital.name || request.hospitalName || "Unknown",
      hospitalLocation: hospital.location || null
    });

    const assignmentsSnap = await db
      .collection("ambulanceAssignments")
      .where("emergencyId", "==", emergencyId)
      .limit(1)
      .get();
    if (!assignmentsSnap.empty) {
      const assignmentRef = assignmentsSnap.docs[0].ref;
      const assignmentUpdate = {
        "hospitalInfo.id": hospitalId,
        "hospitalInfo.name": hospital.name || request.hospitalName || "Unknown",
        "hospitalInfo.location": hospital.location || null,
        "hospitalInfo.specialistName": specialistName,
        "hospitalInfo.confirmedIcuBeds": Number(availableICUBeds) || 0,
        "hospitalInfo.confirmedErBeds": Number(availableERBeds) || 0,
        status: "hospital_confirmed",
        updatedAt: new Date().toISOString()
      };
      console.log("[Firestore Write] ambulanceAssignments specialist update:", {
        assignmentId: assignmentsSnap.docs[0].id,
        ...assignmentUpdate
      });
      await assignmentRef.update(assignmentUpdate);
    }

    const responseId = `hr_${uuidv4()}`;
    const hospitalResponse = {
      id: responseId,
      emergencyId,
      hospitalId,
      specialistName,
      specialty,
      icuBeds: Number(availableICUBeds) || 0,
      erBeds: Number(availableERBeds) || 0,
      status: "accepted",
      respondedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    console.log("[Firestore Write] hospitalResponses specialist response:", hospitalResponse);
    await db.collection("hospitalResponses").doc(responseId).set(hospitalResponse);

    return res.status(200).json({
      assigned: true,
      message: "Specialist response accepted and hospital assigned.",
      hospitalId,
      emergencyId
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to process specialist response" });
  }
};

module.exports = {
  getHospitals,
  selectHospital,
  updateAvailability,
  respondSpecialist
};

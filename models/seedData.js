const db = require("../config/firebase");
const logger = require("../utils/logger");

/** Demo hospitals: trauma/cardiac/accident coverage, mock distance (km) for ranking demos */
const hospitals = [
  {
    id: "hosp_001",
    name: "City Trauma Center",
    location: { lat: 12.9716, lng: 77.5946 },
    icuBeds: 5,
    erBeds: 8,
    specialties: ["trauma", "cardiac", "accident"],
    distance: 1.2
  },
  {
    id: "hosp_002",
    name: "Metro Cardiac Institute",
    location: { lat: 12.9352, lng: 77.6245 },
    icuBeds: 6,
    erBeds: 6,
    specialties: ["trauma", "cardiac", "accident"],
    distance: 2.0
  },
  {
    id: "hosp_003",
    name: "General Emergency Hospital",
    location: { lat: 12.9141, lng: 77.6101 },
    icuBeds: 4,
    erBeds: 10,
    specialties: ["trauma", "cardiac", "accident"],
    distance: 3.5
  }
];

/**
 * Ambulances: 108 (govt emergency) first in dispatch, then govt, then private.
 * Two 108 (both available), two govt (one unavailable), two private (available).
 */
const ambulances = [
  {
    id: "amb_108_001",
    type: "108",
    available: true,
    status: "available",
    location: { lat: 12.972, lng: 77.595 }
  },
  {
    id: "amb_108_002",
    type: "108",
    available: true,
    status: "available",
    location: { lat: 12.968, lng: 77.592 }
  },
  {
    id: "amb_govt_001",
    type: "govt",
    available: true,
    status: "available",
    location: { lat: 12.9698, lng: 77.59 }
  },
  {
    id: "amb_govt_002",
    type: "govt",
    available: false,
    status: "unavailable",
    location: { lat: 12.94, lng: 77.61 }
  },
  {
    id: "amb_priv_001",
    type: "private",
    available: true,
    status: "available",
    location: { lat: 12.98, lng: 77.63 }
  },
  {
    id: "amb_priv_002",
    type: "private",
    available: true,
    status: "available",
    location: { lat: 12.91, lng: 77.58 }
  }
];

const users = [
  {
    id: "user_001",
    name: "Demo User",
    email: "demo.user@example.com",
    phone: "+910000000001"
  }
];

const runSeed = async () => {
  if (!db) {
    throw new Error("Firestore is not initialized. Cannot seed data.");
  }

  for (const hospital of hospitals) {
    await db.collection("hospitals").doc(hospital.id).set({
      ...hospital,
      createdAt: new Date().toISOString()
    });
  }

  for (const ambulance of ambulances) {
    await db.collection("ambulances").doc(ambulance.id).set({
      ...ambulance,
      updatedAt: new Date().toISOString()
    });
  }

  for (const user of users) {
    await db.collection("users").doc(user.id).set({
      ...user,
      createdAt: new Date().toISOString()
    });
  }

  logger.log("Seed completed successfully.");
};

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Seed failed:", error.message);
      process.exit(1);
    });
}

module.exports = {
  hospitals,
  ambulances,
  users,
  runSeed
};

const db = require("../config/firebase");
const logger = require("../utils/logger");

/** Bangalore hospital seed with realistic area-based coordinates. */
const hospitals = [
  {
    id: "hosp_001",
    name: "City Trauma Center",
    location: { lat: 12.9352, lng: 77.6245 }, // Koramangala
    icuBeds: 5,
    erBeds: 8,
    specialties: ["trauma", "cardiac", "accident"],
    distance: 1.2
  },
  {
    id: "hosp_002",
    name: "Metro Cardiac Institute",
    location: { lat: 12.9784, lng: 77.6408 }, // Indiranagar
    icuBeds: 6,
    erBeds: 6,
    specialties: ["trauma", "cardiac", "accident"],
    distance: 2.0
  },
  {
    id: "hosp_003",
    name: "General Emergency Hospital",
    location: { lat: 12.9279, lng: 77.5937 }, // Jayanagar
    icuBeds: 4,
    erBeds: 10,
    specialties: ["trauma", "cardiac", "accident"],
    distance: 3.5
  }
];

/** Bangalore ambulances spread across the city for distance-based dispatching. */
const ambulances = [
  {
    id: "amb_108_001",
    type: "108",
    available: true,
    status: "available",
    location: { lat: 12.9346, lng: 77.6197 } // Koramangala
  },
  {
    id: "amb_108_002",
    type: "108",
    available: true,
    status: "available",
    location: { lat: 12.9719, lng: 77.6412 } // Indiranagar
  },
  {
    id: "amb_govt_001",
    type: "govt",
    available: true,
    status: "available",
    location: { lat: 12.9293, lng: 77.5804 } // Jayanagar
  },
  {
    id: "amb_govt_002",
    type: "govt",
    available: true,
    status: "available",
    location: { lat: 12.9698, lng: 77.7499 } // Whitefield
  },
  {
    id: "amb_priv_001",
    type: "private",
    available: true,
    status: "available",
    location: { lat: 12.9116, lng: 77.6474 } // HSR Layout
  },
  {
    id: "amb_priv_002",
    type: "private",
    available: true,
    status: "available",
    location: { lat: 12.9591, lng: 77.6974 } // Marathahalli
  }
];

const users = [
  {
    id: "user_001",
    name: "Demo User",
    email: "demo.user@example.com",
    phone: "+917275272989"
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

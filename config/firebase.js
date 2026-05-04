const admin = require("firebase-admin");
const dotenv = require("dotenv");

dotenv.config();

let db;

try {
  if (!admin.apps.length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined;

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
      })
    });
  }

  db = admin.firestore();
} catch (error) {
  // Defer hard failures to request-time so local development can still start.
  db = null;
}

module.exports = db;

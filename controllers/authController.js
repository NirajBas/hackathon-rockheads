const { v4: uuidv4 } = require("uuid");
const db = require("../config/firebase");

// Creates a new user record in Firestore.
const register = async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Firestore not configured" });
    }

    const { name, email, phone } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "name and email are required" });
    }

    const userId = `user_${uuidv4()}`;
    const user = {
      id: userId,
      name,
      email,
      phone: phone || null,
      createdAt: new Date().toISOString()
    };

    await db.collection("users").doc(userId).set(user);
    return res.status(201).json({ message: "User registered", user });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Registration failed" });
  }
};

// Returns a mock JWT-like token for demo auth flow.
const login = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    return res.status(200).json({
      message: "Login successful",
      token: `mock-jwt-${uuidv4()}`,
      expiresIn: "1h"
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Login failed" });
  }
};

module.exports = {
  register,
  login
};

const express = require("express");
const authController = require("../controllers/authController");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    await authController.register(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Register route error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    await authController.login(req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Login route error" });
  }
});

module.exports = router;

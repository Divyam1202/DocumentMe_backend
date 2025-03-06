const express = require("express");
const passport = require("passport");
const { getAuthUrl, oauth2Client } = require("../config/firbaseAdmin");
const router = express.Router();

require("../config/passport");

// Route to get Google Authentication URL (for Drive Access)
router.get("/google/url", (req, res) => {
  res.json({ url: getAuthUrl() });
});

// Set up Google OAuth with Drive scope
router.get(
  "/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/drive.file", // Add Drive scope
    ],
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  async (req, res) => {
    try {
      // Store the access token
      const token = req.user.accessToken;
      const userId = req.user.id;
      const email = req.user.email;

      // Redirect with token info
      res.redirect(
        `http://localhost:3000/auth?token=${token}&userId=${userId}&email=${email}`
      );
    } catch (error) {
      console.error("Error in auth callback:", error);
      res.redirect("/");
    }
  }
);

module.exports = router;

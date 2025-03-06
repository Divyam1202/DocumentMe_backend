const admin = require("firebase-admin");
const { google } = require("googleapis");

const serviceAccount = require("../config/firebase-service-account.json"); // Your service account key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Google OAuth2 Client Setup for Drive Permissions
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

// Generate Google Authentication URL
const getAuthUrl = () => {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive.file"], // Google Drive file access
  });
};

// Verify Firebase Authentication Token
const verifyToken = async (token) => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
};

module.exports = { verifyToken, getAuthUrl, oauth2Client };

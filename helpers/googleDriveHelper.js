const { google } = require("googleapis");
const fs = require("fs");

// Use broader scopes to access all files
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
  scopes: [
    "https://www.googleapis.com/auth/drive", // Full access to Drive (not just file creation)
  ],
});

const drive = google.drive({ version: "v3", auth });

// Get or create the Letters folder
const getOrCreateLettersFolder = async () => {
  try {
    // Check if the "Letters" folder exists
    const response = await drive.files.list({
      q: "name='Letters' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id, name)",
    });

    if (response.data.files.length > 0) {
      return response.data.files[0].id;
    } else {
      // Folder doesn't exist, create it
      const folderMetadata = {
        name: "Letters",
        mimeType: "application/vnd.google-apps.folder",
      };

      const folder = await drive.files.create({
        resource: folderMetadata,
        fields: "id",
      });

      return folder.data.id;
    }
  } catch (error) {
    console.error("Error getting or creating Letters folder:", error);
    throw error;
  }
};

// List all files in the user's Google Drive
const listAllFiles = async (pageSize = 30) => {
  try {
    const response = await drive.files.list({
      pageSize: pageSize,
      fields:
        "files(id, name, mimeType, webViewLink, thumbnailLink, createdTime)",
      orderBy: "createdTime desc",
    });
    return response.data.files;
  } catch (error) {
    console.error("Error listing files:", error);
    throw error;
  }
};

// Service account authentication
const serviceAuth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

// Get drive instance with service account auth
const serviceDrive = google.drive({ version: "v3", auth: serviceAuth });

// Function to create a Letters folder in user's Google Drive and grant access to service account
const createUserLettersFolder = async (userEmail, userDriveToken) => {
  try {
    // Create an OAuth2 client for the user
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: userDriveToken });

    // Create a drive instance with user's auth
    const userDrive = google.drive({ version: "v3", auth: oauth2Client });

    // Check if Letters folder already exists in user's drive
    const response = await userDrive.files.list({
      q: "name='Letters' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      spaces: "drive",
      fields: "files(id, name)",
    });

    let folderId;

    if (response.data.files.length > 0) {
      // Folder exists, use it
      folderId = response.data.files[0].id;
      console.log(`Found existing Letters folder: ${folderId}`);
    } else {
      // Create the Letters folder in user's drive
      const folderMetadata = {
        name: "Letters",
        mimeType: "application/vnd.google-apps.folder",
      };

      const folder = await userDrive.files.create({
        resource: folderMetadata,
        fields: "id",
      });

      folderId = folder.data.id;
      console.log(`Created new Letters folder: ${folderId}`);
    }

    // Grant access to the service account
    try {
      await userDrive.permissions.create({
        fileId: folderId,
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress:
            "letter-editor-service-account@editx-452618.iam.gserviceaccount.com",
        },
        fields: "id",
      });

      console.log(`Granted service account access to folder ${folderId}`);
    } catch (err) {
      console.error("Error granting permission to service account:", err);
      // Continue anyway, might already have permission
    }

    return folderId;
  } catch (error) {
    console.error("Error creating/accessing Letters folder:", error);
    throw error;
  }
};

// Function to save document to user's Letters folder
const saveDocumentToUserFolder = async (folderId, title, content) => {
  try {
    // Create file in the folder
    const fileMetadata = {
      name: title,
      parents: [folderId],
      mimeType: "application/vnd.google-apps.document",
    };

    // Using service account to create the file (since it now has permission)
    const file = await serviceDrive.files.create({
      resource: fileMetadata,
      fields: "id,webViewLink",
    });

    // Update content
    await serviceDrive.files.update({
      fileId: file.data.id,
      resource: {
        description: `Letter content: ${content.substring(0, 100)}...`,
      },
    });

    return {
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
    };
  } catch (error) {
    console.error("Error saving document to user's folder:", error);
    throw error;
  }
};

module.exports = {
  getOrCreateLettersFolder,
  listAllFiles,
  drive,
  serviceDrive,
  createUserLettersFolder,
  saveDocumentToUserFolder,
};

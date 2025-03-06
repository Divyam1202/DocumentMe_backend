const express = require("express");
const { google } = require("googleapis");
const Letter = require("../models/Letter");
const User = require("../models/User"); // Add this import
const authMiddleware = require("../middleware/authMiddleware");
const {
  getOrCreateLettersFolder,
  drive,
} = require("../helpers/googleDriveHelper");

const router = express.Router();

// Route to save a letter to Google Drive
router.post("/save", authMiddleware, async (req, res) => {
  const { title, content } = req.body;
  const userId = req.user.uid || req.user.id;
  const userEmail = req.user.email; // Make sure this is available from auth

  try {
    // Find user by googleId
    let user;
    try {
      user = await User.findOne({ googleId: userId });

      if (!user) {
        user = new User({
          googleId: userId,
          name: req.user.name || "Unknown User",
          email: userEmail,
          role: "user",
        });
        await user.save();
      }
    } catch (userErr) {
      console.error("Error finding or creating user:", userErr);
      user = {
        googleId: userId,
        email: userEmail,
      };
    }

    // Ensure the "Letters" folder exists
    const folderId = await getOrCreateLettersFolder();

    // Create a new file in the "Letters" folder
    const fileMetadata = {
      name: `${title}.txt`,
      parents: [folderId],
    };

    const media = {
      mimeType: "text/plain",
      body: content,
    };

    // Create the file
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    const fileId = file.data.id;

    // IMPORTANT: Grant access to the user who created the file
    if (userEmail) {
      try {
        await drive.permissions.create({
          fileId: fileId,
          requestBody: {
            type: "user",
            role: "writer",
            emailAddress: userEmail,
            sendNotificationEmail: false,
          },
        });
        console.log(`Granted access to ${userEmail} for file ${fileId}`);
      } catch (permError) {
        console.error("Error granting file permissions:", permError);
        // Continue anyway - we don't want to fail the whole request
      }
    }

    // Save the letter details to the database
    const newLetter = new Letter({
      userId: userId,
      title,
      content,
      googleDriveId: fileId,
    });

    await newLetter.save();

    res.status(201).json({
      message: "Letter saved successfully",
      fileId: fileId,
      webViewLink: file.data.webViewLink,
    });
  } catch (error) {
    console.error("Error saving letter:", error);
    res
      .status(500)
      .json({ message: "Failed to save letter", error: error.message });
  }
});

// List all top-level files and folders
router.get("/drive-files", authMiddleware, async (req, res) => {
  try {
    // First, get the Letters folder(s)
    const lettersResponse = await drive.files.list({
      q: "name='Letters' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id, name, mimeType, webViewLink, iconLink, createdTime)",
    });

    // Then get other files
    const filesResponse = await drive.files.list({
      q: "trashed=false",
      pageSize: 30,
      fields: "files(id, name, mimeType, webViewLink, iconLink, createdTime)",
      orderBy: "createdTime desc", // Most recent files first
    });

    // Combine and sort all files
    let allFiles = [...lettersResponse.data.files, ...filesResponse.data.files];

    // Remove duplicates based on ID
    const uniqueFiles = [];
    const seenIds = new Set();

    for (const file of allFiles) {
      if (!seenIds.has(file.id)) {
        seenIds.add(file.id);
        uniqueFiles.push(file);
      }
    }

    // Sort by most recent first
    uniqueFiles.sort((a, b) => {
      return new Date(b.createdTime) - new Date(a.createdTime);
    });

    res.status(200).json(uniqueFiles);
  } catch (error) {
    console.error("Error listing files:", error);
    res
      .status(500)
      .json({ message: "Failed to list files", error: error.message });
  }
});

// List files within a specific folder
router.get("/drive-files/:folderId", authMiddleware, async (req, res) => {
  try {
    const folderId = req.params.folderId;

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      pageSize: 100,
      fields: "files(id, name, mimeType, webViewLink, iconLink, createdTime)",
      orderBy: "name",
    });

    res.status(200).json(response.data.files);
  } catch (error) {
    console.error("Error listing folder contents:", error);
    res.status(500).json({
      message: "Failed to list folder contents",
      error: error.message,
    });
  }
});

// Route to fetch saved letters
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const letters = await Letter.find({ userId });

    // Get up-to-date webViewLink for each letter
    const lettersWithLinks = await Promise.all(
      letters.map(async (letter) => {
        try {
          if (letter.googleDriveId) {
            const file = await drive.files.get({
              fileId: letter.googleDriveId,
              fields: "webViewLink,webContentLink",
            });
            return {
              ...letter.toObject(),
              webViewLink: file.data.webViewLink,
              webContentLink: file.data.webContentLink || null,
            };
          }
          return letter.toObject();
        } catch (error) {
          console.error(`Error getting link for letter ${letter._id}:`, error);
          return letter.toObject();
        }
      })
    );

    res.status(200).json(lettersWithLinks);
  } catch (error) {
    console.error("Error fetching letters:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch letters", error: error.message });
  }
});

// Route to add a collaborator to a letter
router.post("/add-collaborator", authMiddleware, async (req, res) => {
  const { letterId, collaboratorEmail } = req.body;

  try {
    // Find the letter
    const letter = await Letter.findById(letterId);

    if (!letter) {
      return res.status(404).json({ message: "Letter not found" });
    }

    const fileId = letter.googleDriveId;

    if (!fileId) {
      return res
        .status(404)
        .json({ message: "Google Drive file ID not found" });
    }

    // Grant specific permission to the collaborator
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: "writer",
        type: "user",
        emailAddress: collaboratorEmail,
      },
      sendNotificationEmail: true,
      emailMessage: "You've been invited to collaborate on this document",
      fields: "id",
    });

    // Add collaborator to the letter document if not already added
    if (!letter.collaborators) {
      letter.collaborators = [];
    }

    if (!letter.collaborators.includes(collaboratorEmail)) {
      letter.collaborators.push(collaboratorEmail);
      await letter.save();
    }

    res.status(200).json({ message: "Collaborator added successfully" });
  } catch (error) {
    console.error("Error adding collaborator:", error);
    res
      .status(500)
      .json({ message: "Failed to add collaborator", error: error.message });
  }
});

// Route to get collaborators for a letter
router.get("/:id/collaborators", authMiddleware, async (req, res) => {
  try {
    const letterId = req.params.id;
    const letter = await Letter.findById(letterId);

    if (!letter) {
      return res.status(404).json({ message: "Letter not found" });
    }

    res.status(200).json(letter.collaborators || []);
  } catch (error) {
    console.error("Error fetching collaborators:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch collaborators", error: error.message });
  }
});

// Route to get a specific letter by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const letter = await Letter.findById(req.params.id);
    if (!letter) {
      return res.status(404).json({ message: "Letter not found" });
    }

    // Get the most recent web view link
    if (letter.googleDriveId) {
      try {
        const file = await drive.files.get({
          fileId: letter.googleDriveId,
          fields: "webViewLink,webContentLink",
        });

        letter.webViewLink = file.data.webViewLink;
        letter.webContentLink = file.data.webContentLink || null;
      } catch (error) {
        console.error(`Error getting Google Drive file: ${error}`);
      }
    }

    res.status(200).json(letter);
  } catch (error) {
    console.error("Error fetching letter:", error);
    res.status(500).json({ message: "Failed to fetch letter" });
  }
});

// Route to update a letter
router.put("/:id", authMiddleware, async (req, res) => {
  const { title, content } = req.body;

  try {
    const letter = await Letter.findById(req.params.id);
    if (!letter) {
      return res.status(404).json({ message: "Letter not found" });
    }

    // Update the letter in the database
    letter.title = title;
    letter.content = content;
    await letter.save();

    // Update the Google Drive file
    if (letter.googleDriveId) {
      await drive.files.update({
        fileId: letter.googleDriveId,
        resource: {
          name: title,
          description: `Letter content: ${content.substring(0, 100)}...`,
        },
      });

      // Get the updated web view link
      const file = await drive.files.get({
        fileId: letter.googleDriveId,
        fields: "webViewLink,webContentLink",
      });

      res.status(200).json({
        message: "Letter updated successfully",
        fileId: letter.googleDriveId,
        webViewLink: file.data.webViewLink,
        webContentLink: file.data.webContentLink || null,
      });
    } else {
      res.status(200).json({ message: "Letter updated successfully" });
    }
  } catch (error) {
    console.error("Error updating letter:", error);
    res.status(500).json({ message: "Failed to update letter" });
  }
});

// Route to delete a letter
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const letterId = req.params.id;

    console.log(`Attempting to delete letter with ID: ${letterId}`);

    // Find the letter to get the Google Drive ID
    const letter = await Letter.findById(letterId);

    if (!letter) {
      console.log(`Letter with ID ${letterId} not found`);
      return res.status(404).json({ message: "Letter not found" });
    }

    // Verify the user owns this letter
    const userId = req.user.uid || req.user.id;
    if (letter.userId !== userId && letter.userId.toString() !== userId) {
      console.log(`User ${userId} not authorized to delete letter ${letterId}`);
      return res
        .status(403)
        .json({ message: "Not authorized to delete this letter" });
    }

    // Delete from Google Drive if we have a Drive ID
    if (letter.googleDriveId) {
      try {
        await drive.files.delete({
          fileId: letter.googleDriveId,
        });
        console.log(`Deleted file ${letter.googleDriveId} from Google Drive`);
      } catch (driveErr) {
        console.error("Error deleting from Google Drive:", driveErr);
        // Continue anyway - we still want to delete from our database
      }
    }

    // Delete from database
    await Letter.findByIdAndDelete(letterId);
    console.log(`Letter ${letterId} deleted from database successfully`);

    res.status(200).json({ message: "Letter deleted successfully" });
  } catch (error) {
    console.error("Error deleting letter:", error);
    res
      .status(500)
      .json({ message: "Failed to delete letter", error: error.message });
  }
});

// Route to fix permissions for all existing files
router.post("/fix-permissions", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Only admins can fix permissions" });
  }

  try {
    // Get all letters
    const letters = await Letter.find({});
    let fixed = 0;
    let failed = 0;

    // Process each letter
    for (const letter of letters) {
      try {
        // Find the user who owns this letter
        const user = await User.findOne({ googleId: letter.userId });

        if (user && user.email && letter.googleDriveId) {
          // Grant permission to the user
          await drive.permissions.create({
            fileId: letter.googleDriveId,
            requestBody: {
              type: "user",
              role: "writer",
              emailAddress: user.email,
              sendNotificationEmail: false,
            },
          });
          fixed++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(
          `Error fixing permissions for letter ${letter._id}:`,
          err
        );
        failed++;
      }
    }

    res.status(200).json({
      message: `Fixed permissions for ${fixed} files. Failed: ${failed}.`,
    });
  } catch (error) {
    console.error("Error fixing permissions:", error);
    res
      .status(500)
      .json({ message: "Failed to fix permissions", error: error.message });
  }
});

// Make sure this export is at the end of the file
module.exports = router;

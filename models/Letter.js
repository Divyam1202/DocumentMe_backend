const mongoose = require("mongoose");

const LetterSchema = new mongoose.Schema({
  userId: {
    type: String, // Use String type for Firebase UIDs, not ObjectId
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  googleDriveId: {
    type: String,
    required: true,
  },
  collaborators: [String], // Ensure this field is present
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Letter", LetterSchema);

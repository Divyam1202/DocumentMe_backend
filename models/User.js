const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  name: String,
  email: String,
  role: { type: String, enum: ["admin", "user"], default: "user" },
  accessToken: String,
  refreshToken: String,
  lettersFolderId: String,
});

module.exports = mongoose.model("User", UserSchema);

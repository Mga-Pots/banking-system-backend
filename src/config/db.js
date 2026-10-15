import mongoose from "mongoose";

export const connectDB = async () => {
  const { DB_USER, DB_PASS, DB_HOST, DB_NAME } = process.env;

  if (!DB_USER || !DB_PASS || !DB_HOST || !DB_NAME) {
    console.error("Missing DB settings. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  const uri = `mongodb+srv://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@${DB_HOST}/${DB_NAME}?retryWrites=true&w=majority`;

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
};
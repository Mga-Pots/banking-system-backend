import mongoose from "mongoose";

export const connectDB = async () => {
  const { DB_USER, DB_PASS, DB_HOST, DB_NAME } = process.env;

  const missingSettings = Object.entries({
    DB_USER,
    DB_PASS,
    DB_HOST,
    DB_NAME,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingSettings.length > 0) {
    throw new Error(
      `Missing database settings: ${missingSettings.join(", ")}. ` +
        "Check your .env file."
    );
  }

  const uri =
    `mongodb+srv://${encodeURIComponent(DB_USER)}` +
    `:${encodeURIComponent(DB_PASS)}@${DB_HOST}/${DB_NAME}` +
    "?retryWrites=true&w=majority";

  await mongoose.connect(uri);

  console.log("MongoDB connected");
};

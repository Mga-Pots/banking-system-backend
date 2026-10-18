import dns from "node:dns";
import mongoose from "mongoose";

// Some ISPs/routers refuse SRV lookups (querySrv ECONNREFUSED); use public DNS.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

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
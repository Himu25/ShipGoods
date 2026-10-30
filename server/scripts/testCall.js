/**
 * Rings VOICE_TEST_NUMBER through our own Sarvam outbound path for a fake
 * booking (see services/voice/testPickupCall.js). The driver stays parked
 * ~1.5 km from pickup since this script exits right after dialling; the
 * deployed POST /api/voice/test-call also drives it towards the pickup.
 *
 * Needs the server running and reachable at PUBLIC_BASE_URL, so the
 * agent's tools and the end-of-call webhook land somewhere.
 * Run: node scripts/testCall.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import getRedisClient from "../src/redisClient.js";
import { placeTestPickupCall, testCallBlocker } from "../src/services/voice/testPickupCall.js";

dotenv.config();

async function main() {
  const blocker = testCallBlocker();
  if (blocker) {
    console.error(`${blocker}. Fix server/.env first.`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const redis = getRedisClient();

  console.log(`Calling ${process.env.VOICE_TEST_NUMBER}…`);
  const { booking, call } = await placeTestPickupCall({ redis, drive: false });

  if (call?.channel === "sarvam" && call.sarvamAttemptId) {
    console.log(`Call placed. Booking ${booking._id}, VoiceCall ${call._id}, Sarvam attempt ${call.sarvamAttemptId}.`);
    console.log("Watch the server log for tool hits and the end-of-call webhook.");
  } else {
    console.error(`Sarvam did not take the call (VoiceCall ${call?._id} fell back to ${call?.channel}). See the error above.`);
    process.exitCode = 1;
  }

  await mongoose.disconnect();
  redis.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

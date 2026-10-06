import mongoose from "mongoose";

const transcriptSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    text: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const toolCallSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    result: { type: mongoose.Schema.Types.Mixed, default: {} },
    ok: { type: Boolean, default: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const voiceCallSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
    },
    status: {
      type: String,
      enum: ["ringing", "active", "completed", "missed", "declined", "failed"],
      default: "ringing",
    },
    callType: {
      type: String,
      enum: ["eta", "arrival"],
      default: "arrival",
    },
    triggerDistanceM: { type: Number },
    retryCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date },
    acknowledged: { type: Boolean, default: false },
    transcript: { type: [transcriptSchema], default: [] },
    toolCalls: { type: [toolCallSchema], default: [] },
    endedReason: { type: String },
    answeredAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true }
);

const VoiceCall = mongoose.model("VoiceCall", voiceCallSchema);
export default VoiceCall;

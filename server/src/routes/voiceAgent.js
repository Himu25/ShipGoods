import express from "express";
import { authenticateToken } from "../middleware/index.js";
import { chatWithAgent, synthesizeSpeech, endAgentCall } from "../controllers/voiceAgent.js";

const router = express.Router();

router.post("/voice-agent/chat", authenticateToken, chatWithAgent);
router.post("/voice-agent/tts", authenticateToken, synthesizeSpeech);
router.post("/voice-agent/end", authenticateToken, endAgentCall);

export default router;

import { WebSocketServer } from "ws";
import { attachVoiceSession } from "./sessionManager.js";

export function initializeVoiceGateway(httpServer, { redis, io }) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const host = request.headers.host || "localhost";
    let url;
    try {
      url = new URL(request.url, `http://${host}`);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== "/voice") return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      attachVoiceSession(ws, url, { redis, io }).catch((err) => {
        console.error("Voice session failed:", err.message);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    });
  });

  return wss;
}

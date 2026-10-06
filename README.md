# ShipGoods is a Logistics Platform for Goods Transportation

## Overview
The **On-Demand Logistics Platform** is a scalable system designed to facilitate goods transportation by connecting users with a fleet of drivers. The platform offers real-time booking, tracking, and price estimation services while ensuring efficient handling of high traffic volumes.
## Key Features

### User Features
- **Booking Service**:  
  Users can book transportation by specifying:
  - Pickup location
  - Drop-off location
  - Type of vehicle (e.g., truck, van)
  - Estimated cost
  
- **Real-Time Tracking**:  
  Track the driver’s location from pickup to drop-off.

- **Price Estimation**:  
  Get upfront price estimates based on distance, vehicle type, and demand.

### Driver Features
- **Job Assignment**:  
  Drivers receive booking requests with details of the job. After accepting, they can see:
  - Pickup and drop-off locations
  - Job details
  
- **Job Status Updates**:  
  Drivers can update job progress:
  - En route to pickup
  - Goods collected
  - Goods delivered

### Admin Features
- **Fleet Management**:  
  Manage vehicle availability, monitor driver activity, and track system health.

- **Data Analytics**:  
  Analytics include:
  - Total trips completed
  - Average trip time
  - Driver performance metrics
  
- **Scheduled Bookings**:  
  Users can schedule trips for future dates and times.

### AI Voice-Call Assistant (Driver Arrival Calls)
ShipGoods places an automated, in-app voice call to the rider at two points in a trip — no phone number or telephony provider involved, it rings straight inside the app over the existing Socket.IO connection:

- **~5 km out** — a heads-up call so the rider can ask about ETA, the driver's name, or the vehicle number before the driver is actually outside.
- **On arrival (~30 m)** — the "I'm here" call, with a car-finder flow if the rider can't spot the vehicle.

**How a call works end to end:**
1. `arrivalDetector.js` watches every live driver-location update against the active trip's pickup point and fires one of the two thresholds above (deduplicated and retried via Redis locks + a `VoiceCall` record, so a trip only rings once per threshold unless missed).
2. The rider's browser answers with native **Web Speech API** recognition (Hindi/Hinglish), sends the transcript to the backend, and plays back the reply as audio — no call stays open longer than the rider keeps talking; there's no auto-hangup.
3. The backend (`services/voiceAgent/`) runs the turn through **Groq** (`openai/gpt-oss-120b`) with function-calling. The model never invents a real-time fact — it can only call one of these tools, each of which re-verifies the booking belongs to the requesting rider before returning anything:
   - `getBookingStatus`, `getVehicleDetails`, `getDriverDetails`
   - `getDriverLocation` — live distance + cardinal direction to the driver
   - `getDestinationETA` — traffic-aware ETA via **Google Routes API**, falling back to a free **OSRM** road-route estimate if Routes is unavailable
   - `findCarLandmark` — the "car-finder" tool: when the rider says they can't see the car, this looks up nearby landmarks via the **Google Places API** around the car's live position, and — when the rider's own GPS is available — tells them which direction to walk and whether they're moving closer or further away since their last attempt, capped at 3 attempts before it hands the rider off to a direct callback from the driver.
4. A guardrails layer (`guardrails.js`) strips markdown, redacts anything that looks like a secret/password/token before it's ever spoken, blocks prompt-injection attempts, and keeps every reply scoped strictly to the rider's own, single booking.
5. The reply is spoken back using **Sarvam AI's** `bulbul:v3` text-to-speech (Hindi, male voice "Shubh").

All agent-facing copy (greetings, refusals, the system prompt) lives in one place — `server/src/services/voiceAgent/constants.js` — so wording, language, or voice can be changed without touching any logic.

Requires these environment variables on the server (`GROQ_API_KEY`, `SARVAM_API_KEY`, `GOOGLE_MAPS_API_KEY`, `VOICE_CALLS_ENABLED=true`) — the feature degrades gracefully (ETA falls back to OSRM, the call simply doesn't trigger) if any are missing, rather than breaking the rest of the app.

---

## Architecture

### System Design
1. **Scalability**:  
   The system is designed to handle high traffic with the following technologies:
   - **MongoDB**: Used as the primary database for user, driver, and booking data.
   - **KafkaJS**: For streaming large amounts of location data efficiently in real time.
   - **Redis**: For caching frequently accessed data such as price estimations and user sessions.
   - **Kubernetes**: Used to scale services horizontally and ensure high availability.
2. **Real-Time Communication**:
   - **Socket.IO** (with a Redis adapter) for live driver tracking, booking updates, and the in-app voice-call signaling — JWT-authenticated per socket, with room-based delivery (`user:<id>`, `driver:<id>`) instead of broadcasting to everyone.

---
## Installation and Setup without Kubernetes

1. Clone the repository:  
   ```bash
   git clone https://github.com/Himu25/ShipGoods.git
   cd ShipGoods
   
2. Backend setup: Navigate to the `server` directory:  
   ```bash
   cd server
   npm install
   docker-compose up
   nodemon src/index
   
3. Frontend setup: Navigate to the `client` directory:  
   ```bash
   cd client
   npm install
   npm run dev

> Both `server/.env` and `client/.env.local` hold the actual secrets (Mongo URI, JWT secret, Groq/Sarvam/Google Maps keys, etc.) and are intentionally untracked — copy from whoever set up your environment and fill them in locally. The voice-call assistant (see above) is the only feature that needs the Groq/Sarvam/Google Maps keys; everything else runs without them.

## Demo Video

[![ShipGoods Demo](https://drive.google.com/thumbnail?id=1o1PXLE25EkY2OdbgKqukt6VLeV8kNX3g&sz=w1000)](https://drive.google.com/file/d/1o1PXLE25EkY2OdbgKqukt6VLeV8kNX3g/view?usp=sharing)

*Click the thumbnail above to watch the demo.*

## Contribution  
Contributions are welcome! Submit pull requests or report issues to help improve the project.



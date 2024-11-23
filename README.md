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
   - WebSockets or MQTT for live tracking and instant job updates.

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

   
## Demo Video  
Watch the [demo video](https://drive.google.com/file/d/1o1PXLE25EkY2OdbgKqukt6VLeV8kNX3g/view?usp=sharing) showcasing the platform's key features and functionality.

## Contribution  
Contributions are welcome! Submit pull requests or report issues to help improve the project.



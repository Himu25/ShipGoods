export const surgcharge = {
  night: 0.15, // 15% night surcharge
  rain: 0.1, // 10% rain surcharge
  "traffic-moderate": 0.1, // 10% for moderate traffic
  "traffic-high": 0.2, // 20% for high traffic
  "dist>100": 0.2, // 20% surcharge for distances over 100 km
  "ratio-1.5": 0.15, // 15% for ratio 1.5
  "ratio-2": 0.25, // 25% for ratio 2
  "ratio-3": 0.35, // 35% for ratio 3
};

export const pricePerKm = {
  car: 12, // 12 INR per km for cars
  bus: 25, // 25 INR per km for buses
  truck: 18, // 18 INR per km for trucks
  motorcycle: 7, // 7 INR per km for motorcycles
};

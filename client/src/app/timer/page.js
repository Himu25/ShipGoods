"use client";
import React, { useEffect, useState } from "react";

export default function page() {
  const [time, setTime] = useState(0);
  const handleChange = (value) => {
    setTime(value);
  };

  const [isPlay, setIsPlay] = useState(false);

  const handlePlay = () => {
    setIsPlay(true);
  };
  const handlePause = () => {
    setIsPlay(false);
  };
  useEffect(() => {
    if (isPlay && time != 0) {
      const interval = setInterval(() => {
        setTime(time - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [time, isPlay]);
  return (
    <>
      <input
        value={time}
        onChange={(e) => handleChange(e.target.value)}
      ></input>
      <div>{time}</div>
      <button onClick={handlePlay}>play</button>
      <button onClick={handlePause}>pause</button>
    </>
  );
}

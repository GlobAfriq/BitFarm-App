import { useState, useEffect, useRef } from "react";

export default function useCountUp(target, duration = 1500) {
  const [value, setValue] = useState(0);
  const startRef = useRef(null);
  const startValRef = useRef(0);

  useEffect(() => {
    if (target === 0) {
      setValue(0);
      return;
    }
    startRef.current = null;
    startValRef.current = value;

    const animate = (timestamp) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      setValue(
        Math.round(
          startValRef.current + (target - startValRef.current) * eased,
        ),
      );

      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [target]);

  return value;
}

// Vendored from tremorlabs/tremor; adapted for CoreOps. See frontend/licenses/tremor.txt.
// Tremor useOnWindowResize [v0.0.2]

import * as React from "react";

export const useOnWindowResize = (handler: () => void) => {
  React.useEffect(() => {
    const handleResize = () => {
      handler();
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [handler]);
};

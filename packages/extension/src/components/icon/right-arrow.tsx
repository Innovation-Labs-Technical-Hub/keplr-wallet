import React, { FunctionComponent } from "react";
import { IconProps } from "./types";

export const RightArrowIcon: FunctionComponent<IconProps> = ({
  width = 20,
  height = 20,
  color = "#72747B",
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.1875 4.375L12.8125 10L7.1875 15.625"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

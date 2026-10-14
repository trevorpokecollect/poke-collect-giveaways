import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_HEIGHT,
  COUNTDOWN_WIDTH,
  countdownGif,
} from "../app/lib/countdown";

// Walks the GIF blocks and counts image descriptors.
const frameCount = (gif: Uint8Array) => {
  let i = 13 + 3 * (1 << ((gif[10] & 7) + 1));
  let n = 0;
  const skipSub = () => {
    while (gif[i] !== 0) i += gif[i] + 1;
    i++;
  };
  while (gif[i] !== 0x3b) {
    if (gif[i] === 0x21) {
      i += 2;
      skipSub();
    } else if (gif[i] === 0x2c) {
      n++;
      i += 10 + 1; // descriptor + LZW min code size
      skipSub();
    } else throw new Error(`bad block at ${i}`);
  }
  return n;
};

describe("countdownGif", () => {
  it("is a looping GIF at the timer size", () => {
    const gif = countdownGif(5 * 3600 + 7 * 60 + 30);
    expect(Buffer.from(gif.slice(0, 6)).toString()).toBe("GIF89a");
    expect(gif[6] | (gif[7] << 8)).toBe(COUNTDOWN_WIDTH);
    expect(gif[8] | (gif[9] << 8)).toBe(COUNTDOWN_HEIGHT);
    expect(Buffer.from(gif).includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
    expect(gif[gif.length - 1]).toBe(0x3b);
    expect(frameCount(gif)).toBe(60);
  });

  it("stops at zero instead of going negative", () => {
    expect(frameCount(countdownGif(3))).toBe(4);
    expect(frameCount(countdownGif(0))).toBe(1);
  });
});

import { expect, test } from "bun:test";
import { isPublicHost, ytdlpArgs } from "./server";

test("private, loopback and metadata hosts are refused", async () => {
  for (const h of ["127.0.0.1", "localhost", "10.0.0.5", "172.18.0.2", "192.168.0.68", "169.254.169.254",
    "100.64.1.1", "0.0.0.0", "[::1]", "[fd00::1]", "[::ffff:127.0.0.1]", "no-such-host.invalid"])
    expect(await isPublicHost(h)).toBe(false);
});

test("public hosts are allowed", async () => {
  for (const h of ["1.1.1.1", "[2606:4700:4700::1111]"]) expect(await isPublicHost(h)).toBe(true);
});

test("yt-dlp runs without the generic extractor", () => {
  const a = ytdlpArgs("https://www.youtube.com/watch?v=x", "mp3");
  expect(a[a.indexOf("--use-extractors") + 1]).toBe("default,-generic");
});

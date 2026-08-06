import { describe, expect, it } from "vitest";

import { installAdvice, isIos, isIosSafari, type InstallContext } from "./install";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 331.0.0.35.90",
  iphoneWhatsApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/WhatsApp]",
  ipadOs:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
};

const ctx = (over: Partial<InstallContext> = {}): InstallContext => ({
  userAgent: UA.iphoneSafari,
  standalone: false,
  hasPrompt: false,
  ...over,
});

describe("isIos", () => {
  it("recognises the obvious devices", () => {
    expect(isIos(UA.iphoneSafari)).toBe(true);
    expect(isIos(UA.iphoneChrome)).toBe(true);
    expect(isIos(UA.androidChrome)).toBe(false);
  });

  // iPadOS 13+ sends a desktop Safari user agent, so an iPad is otherwise
  // indistinguishable from a Mac. Without this, every iPad is told there is
  // nothing to install.
  it("catches an iPad pretending to be a Mac", () => {
    expect(isIos(UA.ipadOs, 5)).toBe(true);
    expect(isIos(UA.macSafari, 0)).toBe(false);
  });
});

describe("isIosSafari", () => {
  it("is true for Safari itself", () => {
    expect(isIosSafari(UA.iphoneSafari)).toBe(true);
    expect(isIosSafari(UA.ipadOs, 5)).toBe(true);
  });

  // These all render with WebKit — the restriction is Apple's policy, not a
  // rendering difference — so nothing but the user agent can separate them.
  it("is false for every other browser on iOS", () => {
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox]) {
      expect(isIosSafari(ua), ua.slice(0, 40)).toBe(false);
    }
  });

  // The most common way to land somewhere that cannot install: tapping a link
  // inside a messaging app.
  it("is false inside an in-app browser", () => {
    expect(isIosSafari(UA.iphoneInstagram)).toBe(false);
    expect(isIosSafari(UA.iphoneWhatsApp)).toBe(false);
  });

  it("is false off iOS entirely", () => {
    expect(isIosSafari(UA.androidChrome)).toBe(false);
    expect(isIosSafari(UA.macSafari, 0)).toBe(false);
  });
});

describe("installAdvice", () => {
  it("says nothing once the app is installed", () => {
    expect(installAdvice(ctx({ standalone: true }))).toBe("INSTALLED");
    // Even where a prompt is somehow still pending.
    expect(installAdvice(ctx({ standalone: true, hasPrompt: true }))).toBe("INSTALLED");
  });

  // A captured prompt is ground truth and beats anything inferred from a string.
  it("prefers a real prompt over user-agent guesswork", () => {
    expect(installAdvice(ctx({ userAgent: UA.androidChrome, hasPrompt: true }))).toBe("PROMPT_READY");
  });

  it("sends iOS Safari through the Share sheet", () => {
    expect(installAdvice(ctx({ userAgent: UA.iphoneSafari }))).toBe("IOS_SAFARI");
    expect(installAdvice(ctx({ userAgent: UA.ipadOs, maxTouchPoints: 5 }))).toBe("IOS_SAFARI");
  });

  // THE ONE THAT MATTERS. Adding to the home screen from Chrome or an in-app
  // browser on iOS produces a shortcut that reopens in a browser — chrome,
  // address bar and all. It is indistinguishable from a broken app unless
  // somebody says which browser to use.
  it("tells anyone in the wrong iOS browser to switch", () => {
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneInstagram, UA.iphoneWhatsApp]) {
      expect(installAdvice(ctx({ userAgent: ua })), ua.slice(0, 40)).toBe("IOS_WRONG_BROWSER");
    }
  });

  it("stays quiet where there is nothing useful to say", () => {
    expect(installAdvice(ctx({ userAgent: UA.macSafari }))).toBe("NOT_AVAILABLE");
    // Android before the prompt event has fired — late, not absent.
    expect(installAdvice(ctx({ userAgent: UA.androidChrome }))).toBe("NOT_AVAILABLE");
  });

  it("never claims a prompt exists on iOS, where the API does not", () => {
    for (const ua of [UA.iphoneSafari, UA.iphoneChrome]) {
      expect(installAdvice(ctx({ userAgent: ua }))).not.toBe("PROMPT_READY");
    }
  });
});

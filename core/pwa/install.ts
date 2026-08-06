/**
 * What to tell someone about installing, given the browser they are actually in.
 *
 * THE PROBLEM THIS SOLVES. On Android, Chrome fires `beforeinstallprompt` and we
 * can offer a real button. On iOS there is no such event and never has been —
 * Apple has not implemented it on any version, so no website can trigger an
 * install. Share → Add to Home Screen is the only path that exists.
 *
 * THE PART THAT IS ACTUALLY A BUG, THOUGH. On iOS, only SAFARI can create a
 * standalone web app. Chrome, Firefox, Edge and every in-app browser on iOS run
 * on WebKit but do not get the install capability, so their "Add to Home Screen"
 * produces a shortcut that opens back inside a browser — chrome, address bar and
 * all. That is the thing people describe as "it saved a bookmark instead of
 * installing", and it is indistinguishable from a broken app unless someone
 * tells you which browser to use.
 *
 * So this returns advice, not a boolean, because the honest answer differs by
 * browser and only one of the cases is an instruction the person can follow
 * where they are standing.
 */

export type InstallAdvice =
  /** Already a standalone app. Say nothing. */
  | "INSTALLED"
  /** The browser offered us a prompt; show a real button. */
  | "PROMPT_READY"
  /** iOS Safari: the Share-sheet route works. Show it. */
  | "IOS_SAFARI"
  /** iOS, but not Safari: installing here produces a bookmark. Send them to Safari. */
  | "IOS_WRONG_BROWSER"
  /** Nothing useful to say — desktop, or a browser that cannot install. */
  | "NOT_AVAILABLE";

export interface InstallContext {
  userAgent: string;
  /** `display-mode: standalone` or the legacy `navigator.standalone`. */
  standalone: boolean;
  /** True once `beforeinstallprompt` has fired and been captured. */
  hasPrompt: boolean;
  /**
   * iPadOS 13+ reports a desktop Safari user agent, so an iPad is otherwise
   * indistinguishable from a Mac. Touch points is the standard tell.
   */
  maxTouchPoints?: number;
}

/** iPhone, iPod, iPad — including an iPad pretending to be a Mac. */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iphone|ipod|ipad/i.test(userAgent)) return true;
  return /macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Non-Safari browsers on iOS, by their own marker in the user agent.
 *
 * Every one of these is WebKit underneath — the restriction is Apple's policy,
 * not a rendering difference — so feature detection cannot separate them and
 * the user agent is the only signal available.
 */
const NOT_SAFARI_ON_IOS = [
  /CriOS/i, // Chrome
  /FxiOS/i, // Firefox
  /EdgiOS/i, // Edge
  /OPiOS|OPT\//i, // Opera
  /DuckDuckGo/i,
  /Brave/i,
  // In-app browsers. Someone who opened a link from a message is here, and it
  // is the single most common way to land in a browser that cannot install.
  /FBAN|FBAV|FB_IAB/i, // Facebook
  /Instagram/i,
  /Line\//i,
  /Twitter|TwitterAndroid/i,
  /LinkedInApp/i,
  /WhatsApp/i,
  /SnapChat/i,
  /Pinterest/i,
  /GSA\//i, // the Google app
];

export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  if (!isIos(userAgent, maxTouchPoints)) return false;
  return !NOT_SAFARI_ON_IOS.some((pattern) => pattern.test(userAgent));
}

export function installAdvice(ctx: InstallContext): InstallAdvice {
  if (ctx.standalone) return "INSTALLED";

  // Checked before the platform tests: if a browser has actually offered us a
  // prompt, that is ground truth and beats anything inferred from a string.
  if (ctx.hasPrompt) return "PROMPT_READY";

  const touch = ctx.maxTouchPoints ?? 0;
  if (isIos(ctx.userAgent, touch)) {
    return isIosSafari(ctx.userAgent, touch) ? "IOS_SAFARI" : "IOS_WRONG_BROWSER";
  }

  // Desktop, or Android before the prompt event has fired. Saying nothing beats
  // explaining a capability that is absent or merely late.
  return "NOT_AVAILABLE";
}

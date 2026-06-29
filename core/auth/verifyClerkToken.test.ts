import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTVerifyGetKey, KeyLike } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { ClerkTokenError, verifyClerkToken } from "./verifyClerkToken";

const ISSUER = "https://test-app.clerk.accounts.dev";
const KID = "test-key-1";

let privateKey: KeyLike;
let getKey: JWTVerifyGetKey;
let otherPrivateKey: KeyLike; // a key NOT in the published JWKS

async function mintToken(opts: {
  sub?: string;
  issuer?: string;
  expiresIn?: string;
  signWith?: KeyLike;
  kid?: string;
}): Promise<string> {
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? KID })
    .setIssuer(opts.issuer ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "2h");
  if (opts.sub !== undefined) builder.setSubject(opts.sub);
  return builder.sign(opts.signWith ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  getKey = createLocalJWKSet({ keys: [publicJwk] });

  otherPrivateKey = (await generateKeyPair("RS256")).privateKey;
});

describe("verifyClerkToken", () => {
  it("ACCEPTS a properly signed, unexpired token and returns the sub", async () => {
    const token = await mintToken({ sub: "user_2abcXYZ" });
    const principal = await verifyClerkToken(token, { getKey, issuer: ISSUER });
    expect(principal.clerkUserId).toBe("user_2abcXYZ");
    expect(principal.claims.iss).toBe(ISSUER);
  });

  it("REJECTS a token with a tampered signature", async () => {
    const token = await mintToken({ sub: "user_1" });
    const tampered = token.slice(0, -3) + (token.endsWith("AAA") ? "BBB" : "AAA");
    await expect(verifyClerkToken(tampered, { getKey, issuer: ISSUER })).rejects.toBeInstanceOf(
      ClerkTokenError,
    );
  });

  it("REJECTS an expired token", async () => {
    const token = await mintToken({ sub: "user_1", expiresIn: "-1h" });
    await expect(verifyClerkToken(token, { getKey, issuer: ISSUER })).rejects.toBeInstanceOf(
      ClerkTokenError,
    );
  });

  it("REJECTS a token from the wrong issuer", async () => {
    const token = await mintToken({ sub: "user_1", issuer: "https://evil.example" });
    await expect(verifyClerkToken(token, { getKey, issuer: ISSUER })).rejects.toBeInstanceOf(
      ClerkTokenError,
    );
  });

  it("REJECTS a token signed by a key that is not in the JWKS", async () => {
    const token = await mintToken({ sub: "user_1", signWith: otherPrivateKey });
    await expect(verifyClerkToken(token, { getKey, issuer: ISSUER })).rejects.toBeInstanceOf(
      ClerkTokenError,
    );
  });

  it("REJECTS a token with no subject claim", async () => {
    const token = await mintToken({}); // no sub
    await expect(verifyClerkToken(token, { getKey, issuer: ISSUER })).rejects.toThrow(/subject/i);
  });

  it("REJECTS an empty token", async () => {
    await expect(verifyClerkToken("", { getKey, issuer: ISSUER })).rejects.toBeInstanceOf(
      ClerkTokenError,
    );
  });
});

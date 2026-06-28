import { customAlphabet } from "nanoid";

/**
 * Opaque ID generation for GetCAD.
 *
 * Every primary key in this system is an opaque, random, URL-safe string —
 * NEVER a sequential integer. Sequential integers leak information (how many
 * orders exist, signup order, growth rate) and let an attacker walk the ID
 * space. In an anonymity-critical, double-blind marketplace that is a leak we
 * cannot afford.
 *
 * One helper, used everywhere, so the alphabet and length never drift.
 */

// URL-safe, unambiguous alphabet (no look-alikes like 0/O, 1/l/I).
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

// 21 chars over a 55-symbol alphabet ≈ 121 bits of entropy — collision risk is
// negligible at any realistic scale.
export const ID_LENGTH = 21;

const nano = customAlphabet(ALPHABET, ID_LENGTH);

/** Generate a new opaque ID. */
export function generateId(): string {
  return nano();
}

/** Regex describing a well-formed opaque ID (used by tests and validators). */
export const ID_PATTERN = new RegExp(`^[${ALPHABET}]{${ID_LENGTH}}$`);

/** True if `value` looks like an opaque ID produced by {@link generateId}. */
export function isOpaqueId(value: string): boolean {
  return ID_PATTERN.test(value);
}
